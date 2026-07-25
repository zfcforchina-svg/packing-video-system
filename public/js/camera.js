/**
 * 打包录像 — 原生相机拍照扫码 + 录像
 * 拍照 → scanFile解码 → 录像 → 上传 → 下一单
 */
(function(){
const $=s=>document.querySelector(s);

const status=$('#status');
const trackingDisplay=$('#trackingDisplay');
const fileCard=$('#fileCard');
const fileDisplay=$('#fileDisplay');
const previewVideo=$('#previewVideo');
const scanMsg=$('#scanMsg');
const btnScan=$('#btnScan');
const btnRecord=$('#btnRecord');
const btnUpload=$('#btnUpload');
const btnNext=$('#btnNext');
const scanInput=$('#scanInput');
const recordInput=$('#recordInput');
const scanImg=$('#scanImg');

let tracking='';
let videoBlob=null;
let socket=null;
let connected=false;

// ---- Init ----
function init(){
  socket=io({reconnection:true});
  socket.on('connect',()=>{connected=true;status.textContent='🟢 已连接电脑';status.style.color='#4ade80';});
  socket.on('disconnect',()=>{connected=false;status.textContent='🔴 未连接（视频存手机）';status.style.color='#f87171';});

  btnScan.onclick=()=>scanInput.click();
  btnRecord.onclick=()=>recordInput.click();
  btnUpload.onclick=doUpload;
  btnNext.onclick=resetAll;

  scanInput.onchange=handleScan;
  recordInput.onchange=handleRecord;
}

// ---- STEP 1: Take photo → decode barcode (with image preprocessing) ----
async function handleScan(){
  const rawFile=scanInput.files[0];
  if(!rawFile)return;
  scanInput.value='';

  btnScan.disabled=true;
  btnScan.textContent='🔍 识别中...';
  scanMsg.classList.remove('hid');
  scanMsg.style.color='#94a3b8';

  try{
    // Load image
    const img=new Image();
    img.src=URL.createObjectURL(rawFile);
    await new Promise((r,rej)=>{img.onload=r;img.onerror=rej;});
    URL.revokeObjectURL(img.src);

    let result=null;

    // ---- Preprocess: generate multiple variants ----
    const variants=[];

    // Variant 1: Resized to max 2000px (standard)
    const c1=document.createElement('canvas');
    const MAX=2000;let w=img.width,h=img.height;
    if(w>MAX||h>MAX){const s=MAX/Math.max(w,h);w=Math.round(w*s);h=Math.round(h*s);}
    c1.width=w;c1.height=h;
    c1.getContext('2d').drawImage(img,0,0,w,h);
    variants.push({canvas:c1,label:'standard'});

    // Variant 2: Grayscale + contrast enhanced (helps thermal print barcodes)
    const c2=document.createElement('canvas');
    c2.width=w;c2.height=h;
    const ctx2=c2.getContext('2d');
    ctx2.drawImage(img,0,0,w,h);
    const idata=ctx2.getImageData(0,0,w,h);
    const d=idata.data;
    for(let i=0;i<d.length;i+=4){
      const gray=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; // luminosity
      const enhanced=Math.min(255,Math.max(0,(gray-128)*1.8+128)); // increase contrast
      d[i]=d[i+1]=d[i+2]=enhanced;
    }
    ctx2.putImageData(idata,0,0);
    variants.push({canvas:c2,label:'enhanced'});

    // Variant 3: Thresholded (pure black/white) — best for barcodes
    const c3=document.createElement('canvas');
    c3.width=w;c3.height=h;
    const ctx3=c3.getContext('2d');
    ctx3.drawImage(img,0,0,w,h);
    const idata3=ctx3.getImageData(0,0,w,h);
    const d3=idata3.data;
    // Calculate threshold using Otsu-like method (simplified)
    let sum=0;
    for(let i=0;i<d3.length;i+=4)sum+=0.299*d3[i]+0.587*d3[i+1]+0.114*d3[i+2];
    const threshold=sum/(d3.length/4);
    for(let i=0;i<d3.length;i+=4){
      const gray=0.299*d3[i]+0.587*d3[i+1]+0.114*d3[i+2];
      const v=gray>threshold?255:0;
      d3[i]=d3[i+1]=d3[i+2]=v;
    }
    ctx3.putImageData(idata3,0,0);
    variants.push({canvas:c3,label:'threshold'});

    // Try each variant with both detection methods
    for(const variant of variants){
      if(result)break;
      scanMsg.textContent='正在解码... ('+variant.label+')';

      // Method A: Native BarcodeDetector
      if('BarcodeDetector' in window){
        try{
          const allFormats=['code_128','code_39','code_93','codabar','ean_13','ean_8',
            'upc_a','upc_e','itf','pdf417','data_matrix','aztec','qr_code'];
          const detector=new BarcodeDetector({formats:allFormats});
          const codes=await detector.detect(variant.canvas);
          if(codes.length>0){result=codes[0].rawValue;break;}
        }catch(e){}
      }

      // Method B: html5-qrcode scanFile on blob from variant canvas
      try{
        const blob=await new Promise(r=>variant.canvas.toBlob(r,'image/jpeg',0.95));
        const file=new File([blob],'barcode.jpg',{type:'image/jpeg'});
        const scanner=new Html5Qrcode('scanImg');
        result=await scanner.scanFile(file,false);
        if(result)break;
      }catch(e){}
    }

    if(!result)throw new Error('所有方法均未能识别条码');

    tracking=result.replace(/[^a-zA-Z0-9]/g,'').trim();
    if(!tracking||tracking.length<4)throw new Error('识别结果无效');

    trackingDisplay.textContent=tracking;
    trackingDisplay.classList.remove('placeholder');
    btnScan.textContent='📸 重新扫码';
    btnScan.disabled=false;
    btnRecord.classList.remove('hid');
    scanMsg.classList.add('hid');
    status.textContent='✅ 单号: '+tracking;
    status.style.color='#4ade80';

  }catch(err){
    console.error('Scan error:',err);
    // Show photo for manual entry
    scanImg.src=URL.createObjectURL(rawFile);
    scanImg.style.display='block';
    scanImg.style.maxWidth='100%';
    scanImg.style.borderRadius='8px';
    scanImg.style.marginTop='8px';
    trackingDisplay.textContent='点击输入单号';
    trackingDisplay.classList.remove('placeholder');
    trackingDisplay.contentEditable='true';
    trackingDisplay.style.outline='2px dashed #fbbf24';
    trackingDisplay.style.borderRadius='4px';
    trackingDisplay.style.padding='8px';
    trackingDisplay.focus();
    btnScan.textContent='📸 重新拍照';
    btnScan.disabled=false;
    btnRecord.classList.remove('hid');
    scanMsg.textContent='👆 识别失败，看照片手动输入单号';
    scanMsg.style.color='#fbbf24';
    trackingDisplay.oninput=()=>{
      tracking=trackingDisplay.textContent.replace(/[^a-zA-Z0-9]/g,'').trim();
    };
  }
}

// ---- STEP 2: Record video ----
function handleRecord(){
  const file=recordInput.files[0];
  if(!file)return;
  recordInput.value='';

  videoBlob=file;
  const mb=(file.size/1048576).toFixed(1);
  fileDisplay.textContent=tracking+'.mp4 ('+mb+'MB)';
  fileCard.classList.remove('hid');
  previewVideo.src=URL.createObjectURL(file);
  previewVideo.style.display='block';
  btnRecord.classList.add('hid');
  btnUpload.classList.remove('hid');
  status.textContent='✅ 录像完成';
}

// ---- STEP 3: Upload ----
async function doUpload(){
  if(!videoBlob||!tracking)return;

  if(!connected){
    status.textContent='⚠️ 未连接，通过数据线拷贝视频到 usb-import/';
    status.style.color='#fbbf24';
    saveToPhone();
    showNext();return;
  }

  btnUpload.disabled=true;
  btnUpload.textContent='上传中...';

  const fid=tracking+'_'+Date.now();
  const sz=videoBlob.size,cs=256*1024,total=Math.ceil(sz/cs);
  try{
    await ws('upload:start',{fileId:fid,trackingNumber:tracking,totalSize:sz,duration:0});
    for(let i=0;i<total;i++){
      const b=videoBlob.slice(i*cs,Math.min((i+1)*cs,sz));
      await ws('upload:chunk',{fileId:fid,index:i,data:await b.arrayBuffer()});
      btnUpload.textContent='上传 '+Math.round((i+1)/total*100)+'%';
    }
    await ws('upload:complete',{fileId:fid});
    btnUpload.textContent='☁️ 上传完成 ✅';
    status.textContent='✅ 上传完成 — '+tracking;
  }catch(e){
    status.textContent='⚠️ 上传失败，已存手机 — '+e.message;
    status.style.color='#fbbf24';
    saveToPhone();
  }
  showNext();
}

function ws(ev,d){return new Promise((resolve,reject)=>{
  const t=setTimeout(()=>reject(new Error('超时')),120000);
  socket.emit(ev,d,r=>{clearTimeout(t);r?.error?reject(new Error(r.error)):resolve(r||{});});
});}

function saveToPhone(){
  if(!videoBlob)return;
  const url=URL.createObjectURL(videoBlob);
  const a=document.createElement('a');a.href=url;a.download=tracking+'.mp4';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}

function showNext(){
  btnUpload.classList.add('hid');btnNext.classList.remove('hid');
}

// ---- Next ----
function resetAll(){
  tracking='';videoBlob=null;
  trackingDisplay.textContent='拍摄条码获取';trackingDisplay.classList.add('placeholder');
  trackingDisplay.contentEditable='false';
  trackingDisplay.style.outline='';trackingDisplay.style.borderRadius='';trackingDisplay.style.padding='';
  trackingDisplay.oninput=null;
  scanImg.src='';scanImg.style.display='none';
  fileCard.classList.add('hid');previewVideo.style.display='none';
  btnScan.textContent='📸 拍条码识别单号';btnScan.disabled=false;btnScan.classList.remove('hid');
  btnRecord.classList.add('hid');btnUpload.classList.add('hid');btnNext.classList.add('hid');
  scanMsg.classList.add('hid');scanMsg.style.color='#fbbf24';
  status.textContent=connected?'🟢 准备就绪':'🔴 未连接';status.style.color=connected?'#4ade80':'#f87171';
}

init();
})();
