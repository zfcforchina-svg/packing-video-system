/**
 * 打包录像 — 手动为主，拍照识别为辅
 */
(function(){
const $=s=>document.querySelector(s);
const connEl=$('#conn');
const trackingInput=$('#trackingInput');
const scanPreview=$('#scanPreview');
const btnScan=$('#btnScan');
const btnRecord=$('#btnRecord');
const btnUpload=$('#btnUpload');
const btnNext=$('#btnNext');
const scanInput=$('#scanInput');
const recordInput=$('#recordInput');

let videoBlob=null;
let socket=null;
let connected=false;

// ---- Init ----
function init(){
  socket=io({reconnection:true});
  socket.on('connect',()=>{connected=true;connEl.textContent='🟢 已连接电脑';connEl.className='conn-ok';});
  socket.on('disconnect',()=>{connected=false;connEl.textContent='🔴 未连接（视频存手机）';connEl.className='conn-err';});

  // Enable record button when user types tracking number
  trackingInput.oninput=()=>{
    const len=trackingInput.value.replace(/[^a-zA-Z0-9]/g,'').length;
    btnRecord.classList.toggle('hid',len<4);
  };

  btnScan.onclick=()=>scanInput.click();
  btnRecord.onclick=()=>recordInput.click();
  btnUpload.onclick=doUpload;
  btnNext.onclick=resetAll;

  scanInput.onchange=handleScan;
  recordInput.onchange=handleRecord;
}

// ---- Take photo → server-side ZBar decode (primary) ----
async function handleScan(){
  const file=scanInput.files[0];
  if(!file)return;
  scanInput.value='';

  btnScan.disabled=true;
  btnScan.textContent='🔍 识别中...';

  // Show photo preview
  scanPreview.src=URL.createObjectURL(file);
  scanPreview.style.display='block';

  let result=null;

  // Method 1: Server-side ZBar (most reliable for express barcodes)
  try{
    btnScan.textContent='🔍 服务端解码...';
    const form=new FormData();
    form.append('image',file);
    const resp=await fetch('/api/decode',{method:'POST',body:form});
    const data=await resp.json();
    if(data.success&&data.tracking){
      result=data.tracking;
    }
  }catch(e){/* server unavailable, try client-side */}

  // Method 2: Client-side BarcodeDetector + scanFile
  if(!result){
    try{
      btnScan.textContent='🔍 本地解码...';
      const img=new Image();
      img.src=URL.createObjectURL(file);
      await new Promise((r,rej)=>{img.onload=r;img.onerror=rej;});
      const MAX=2000;let w=img.width,h=img.height;
      if(w>MAX||h>MAX){const s=MAX/Math.max(w,h);w=Math.round(w*s);h=Math.round(h*s);}
      const c=document.createElement('canvas');c.width=w;c.height=h;
      c.getContext('2d').drawImage(img,0,0,w,h);

      if('BarcodeDetector' in window){
        try{
          const det=new BarcodeDetector({formats:['code_128','code_39','code_93','codabar',
            'ean_13','ean_8','upc_a','upc_e','itf','pdf417','data_matrix','aztec','qr_code']});
          const codes=await det.detect(c);
          if(codes.length>0)result=codes[0].rawValue;
        }catch(e){}
      }

      if(!result){
        const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',0.92));
        const f=new File([blob],'b.jpg',{type:'image/jpeg'});
        const scanner=new Html5Qrcode('scanHelper');
        result=await scanner.scanFile(f,false);
      }
    }catch(e){}
  }

  // Done
  btnScan.disabled=false;

  if(result){
    const clean=result.replace(/[^a-zA-Z0-9]/g,'').trim();
    if(clean.length>=4){
      trackingInput.value=clean;
      trackingInput.dispatchEvent(new Event('input'));
      btnScan.textContent='✅ 已识别';
      setTimeout(()=>{btnScan.textContent='📸 拍照填单号';},1500);
      return;
    }
  }

  // Failed — user types manually
  btnScan.textContent='📸 重拍（或手动输入）';
  trackingInput.placeholder='看照片手动输入单号';
  trackingInput.focus();
}

// ---- Record video ----
function handleRecord(){
  const file=recordInput.files[0];
  if(!file)return;
  recordInput.value='';
  videoBlob=file;

  btnRecord.classList.add('hid');
  btnUpload.classList.remove('hid');
  connEl.textContent='✅ 录像完成 — '+trackingInput.value;
  connEl.className='conn-ok';
}

// ---- Upload ----
async function doUpload(){
  const tracking=trackingInput.value.replace(/[^a-zA-Z0-9]/g,'').trim();
  if(!videoBlob||!tracking)return;

  if(!connected){
    connEl.textContent='⚠️ 未连接，视频已存手机。连WiFi后重试';
    connEl.className='conn-err';
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
    connEl.textContent='✅ 完成 — '+tracking;
    connEl.className='conn-ok';
  }catch(e){
    connEl.textContent='⚠️ 上传失败，已存手机';
    connEl.className='conn-err';
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
  const t=trackingInput.value.replace(/[^a-zA-Z0-9]/g,'').trim()||'unknown';
  const url=URL.createObjectURL(videoBlob);
  const a=document.createElement('a');a.href=url;a.download=t+'.mp4';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}

function showNext(){
  btnUpload.classList.add('hid');btnNext.classList.remove('hid');
}

// ---- Next package ----
function resetAll(){
  trackingInput.value='';trackingInput.placeholder='扫描或输入快递单号';
  scanPreview.src='';scanPreview.style.display='none';
  videoBlob=null;
  btnScan.textContent='📸 拍照填单号';btnScan.disabled=false;
  btnRecord.classList.add('hid');
  btnUpload.classList.add('hid');btnNext.classList.add('hid');
  connEl.textContent=connected?'🟢 准备就绪':'🔴 未连接';connEl.className=connected?'conn-ok':'conn-err';
}

init();
})();
