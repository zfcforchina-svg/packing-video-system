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

// ---- STEP 1: Take photo → decode barcode ----
async function handleScan(){
  const rawFile=scanInput.files[0];
  if(!rawFile)return;
  scanInput.value='';

  btnScan.disabled=true;
  btnScan.textContent='🔍 识别中...';
  scanMsg.classList.remove('hid');
  scanMsg.textContent='正在解码条码...';

  try{
    // Convert to JPEG (iPhone shoots HEIC, which ZXing can't read)
    // Also resize to max 2000px for faster decoding
    const img=new Image();
    img.src=URL.createObjectURL(rawFile);
    await new Promise((r,rej)=>{img.onload=r;img.onerror=rej;});
    const MAX=2000;
    let w=img.width,h=img.height;
    if(w>MAX||h>MAX){const s=MAX/Math.max(w,h);w=Math.round(w*s);h=Math.round(h*s);}
    const canvas=document.createElement('canvas');
    canvas.width=w;canvas.height=h;
    canvas.getContext('2d').drawImage(img,0,0,w,h);
    const jpegBlob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',0.9));
    const file=new File([jpegBlob],'barcode.jpg',{type:'image/jpeg'});
    URL.revokeObjectURL(img.src);

    let result=null;

    // Method 1: Native BarcodeDetector (fast, reliable)
    if('BarcodeDetector' in window){
      try{
        const detector=new BarcodeDetector({formats:['code_128','code_39','ean_13','ean_8','qr_code']});
        const codes=await detector.detect(img);
        if(codes.length>0){result=codes[0].rawValue;}
      }catch(e){/* fall through */}
    }

    // Method 2: html5-qrcode scanFile (fallback)
    if(!result){
      try{
        const scanner=new Html5Qrcode('scanImg');
        result=await scanner.scanFile(file,false);
      }catch(e2){throw new Error('两种方式都未能识别条码');}
    }

    tracking=(result||'').replace(/[^a-zA-Z0-9]/g,'').trim();
    if(!tracking||tracking.length<4)throw new Error('未识别到有效单号: '+(result||'空'));

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
    trackingDisplay.textContent='识别失败';
    btnScan.textContent='📸 拍条码识别单号';
    btnScan.disabled=false;
    scanMsg.textContent='❌ '+(err.message||'识别失败，请重试');
    setTimeout(()=>scanMsg.classList.add('hid'),5000);
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
  fileCard.classList.add('hid');previewVideo.style.display='none';
  btnScan.textContent='📸 拍条码识别单号';btnScan.disabled=false;btnScan.classList.remove('hid');
  btnRecord.classList.add('hid');btnUpload.classList.add('hid');btnNext.classList.add('hid');
  status.textContent=connected?'🟢 准备就绪':'🔴 未连接';status.style.color=connected?'#4ade80':'#f87171';
}

init();
})();
