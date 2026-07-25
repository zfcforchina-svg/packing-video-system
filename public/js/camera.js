/**
 * 打包录像 — 实时预览 + 服务端ZBar自动解码
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
const recordInput=$('#recordInput');

let videoBlob=null;
let socket=null;
let connected=false;
let scanStream=null;      // camera for scanning
let scanVideo=null;       // hidden video element for scanning
let scanTimer=0;          // setInterval for auto-scan
let scanRunning=false;

// ---- Init ----
function init(){
  socket=io({reconnection:true});
  socket.on('connect',()=>{connected=true;connEl.textContent='🟢 已连接';connEl.className='conn-ok';});
  socket.on('disconnect',()=>{connected=false;connEl.textContent='🔴 未连接';connEl.className='conn-err';});

  trackingInput.oninput=()=>{
    const len=trackingInput.value.replace(/[^a-zA-Z0-9]/g,'').length;
    btnRecord.classList.toggle('hid',len<4);
  };

  btnScan.onclick=startAutoScan;
  btnRecord.onclick=()=>recordInput.click();
  btnUpload.onclick=doUpload;
  btnNext.onclick=resetAll;
  recordInput.onchange=handleRecord;

  // Auto-start scanning
  startAutoScan();
}

// ---- Open camera + auto-scan loop ----
async function startAutoScan(){
  if(scanRunning)return;

  btnScan.disabled=true;
  btnScan.textContent='📸 启动摄像头...';

  // Open back camera
  try{
    scanStream=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{exact:'environment'},width:{ideal:1280},height:{ideal:720}},
      audio:false
    });
  }catch(e){
    try{scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment',width:{ideal:1280}},audio:false});}
    catch(e2){scanStream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});}
  }

  // Create video in camera preview area
  if(!scanVideo){
    scanVideo=document.createElement('video');
    scanVideo.setAttribute('autoplay','');scanVideo.setAttribute('muted','');scanVideo.setAttribute('playsinline','');
    scanVideo.style.cssText='width:100%;height:100%;object-fit:cover';
    const camView=document.getElementById('camView');
    camView.insertBefore(scanVideo,camView.firstChild);
  }
  scanVideo.srcObject=scanStream;
  await scanVideo.play();

  btnScan.textContent='🔍 自动扫描中...';
  btnScan.disabled=true;
  scanPreview.style.display='block';
  scanRunning=true;
  connEl.textContent='🔍 将条码对准摄像头';

  // Auto-scan loop: always keep running, even if frame not ready
  let scanBusy=false;
  async function scanLoop(){
    if(!scanRunning)return;
    scanTimer=setTimeout(scanLoop,400);

    if(scanBusy)return;
    if(!scanVideo||scanVideo.readyState<2||!scanVideo.videoWidth)return;

    scanBusy=true;
    try{
      const c=document.createElement('canvas');
      c.width=scanVideo.videoWidth;
      c.height=scanVideo.videoHeight;
      c.getContext('2d').drawImage(scanVideo,0,0,c.width,c.height);
      const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',0.85));

      const fd=new FormData();fd.append('image',blob);
      const resp=await fetch('/api/decode',{method:'POST',body:fd});
      const data=await resp.json();

      if(data.success&&data.tracking){
        const clean=data.tracking.replace(/[^a-zA-Z0-9]/g,'').trim();
        if(clean.length>=4){
          stopAutoScan();
          trackingInput.value=clean;
          trackingInput.dispatchEvent(new Event('input'));
          btnScan.textContent='✅ 已识别: '+clean;
          btnScan.disabled=false;
          connEl.textContent='✅ 单号: '+clean;
        }
      }
    }catch(e){/* keep scanning */}
    scanBusy=false;
  }
  scanLoop();
}

function stopAutoScan(){
  scanRunning=false;
  clearTimeout(scanTimer);
  if(scanStream){scanStream.getTracks().forEach(t=>t.stop());scanStream=null;}
  if(scanVideo){scanVideo.srcObject=null;scanVideo.style.display='none';}
}

// ---- Record ----
function handleRecord(){
  const file=recordInput.files[0];
  if(!file)return;recordInput.value='';
  videoBlob=file;
  btnRecord.classList.add('hid');btnUpload.classList.remove('hid');
  connEl.textContent='✅ 录像完成';connEl.className='conn-ok';
}

async function doUpload(){
  const t=trackingInput.value.replace(/[^a-zA-Z0-9]/g,'').trim();
  if(!videoBlob||!t)return;
  if(!connected){connEl.textContent='⚠️ 未连接，已存手机';saveToPhone();showNext();return;}
  btnUpload.disabled=true;btnUpload.textContent='上传中...';
  const fid=t+'_'+Date.now();const sz=videoBlob.size,cs=256*1024,total=Math.ceil(sz/cs);
  try{
    await ws('upload:start',{fileId:fid,trackingNumber:t,totalSize:sz,duration:0});
    for(let i=0;i<total;i++){
      const b=videoBlob.slice(i*cs,Math.min((i+1)*cs,sz));
      await ws('upload:chunk',{fileId:fid,index:i,data:await b.arrayBuffer()});
      btnUpload.textContent='上传 '+Math.round((i+1)/total*100)+'%';
    }
    await ws('upload:complete',{fileId:fid});
    btnUpload.textContent='☁️ 上传完成';connEl.textContent='✅ 完成 — '+t;
  }catch(e){connEl.textContent='⚠️ 上传失败，已存手机';saveToPhone();}
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

function showNext(){btnUpload.classList.add('hid');btnNext.classList.remove('hid');}

function resetAll(){
  trackingInput.value='';trackingInput.placeholder='扫描或输入快递单号';
  scanPreview.src='';scanPreview.style.display='none';
  videoBlob=null;
  btnScan.textContent='📸 拍照填单号';btnScan.disabled=false;
  btnRecord.classList.add('hid');btnUpload.classList.add('hid');btnNext.classList.add('hid');
  connEl.textContent=connected?'🟢 准备就绪':'🔴 未连接';connEl.className=connected?'conn-ok':'conn-err';
  stopAutoScan();
  startAutoScan(); // restart scanner for next package
}

init();
})();
