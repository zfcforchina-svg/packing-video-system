const $=s=>document.querySelector(s);
let currentVideo=null,currentPage=1,socket=null,selectedVideos=new Set();

const dom={
  connectionBadge:$('#connectionBadge'),searchInput:$('#searchInput'),dateFrom:$('#dateFrom'),dateTo:$('#dateTo'),
  searchBtn:$('#searchBtn'),clearSearchBtn:$('#clearSearchBtn'),searchResult:$('#searchResult'),
  videoList:$('#videoList'),emptyState:$('#emptyState'),pagination:$('#pagination'),
  prevPageBtn:$('#prevPageBtn'),nextPageBtn:$('#nextPageBtn'),pageInfo:$('#pageInfo'),
  statTotal:$('#statTotal'),statSize:$('#statSize'),statToday:$('#statToday'),statFree:$('#statFree'),
  playerModal:$('#playerModal'),playerVideo:$('#playerVideo'),playerTitle:$('#playerTitle'),playerInfo:$('#playerInfo'),
  closePlayer:$('#closePlayer'),copyTrackingBtn:$('#copyTrackingBtn'),downloadVideoBtn:$('#downloadVideoBtn'),deleteVideoBtn:$('#deleteVideoBtn'),
  selectAll:$('#selectAll'),batchDownloadBtn:$('#batchDownloadBtn'),batchDeleteBtn:$('#batchDeleteBtn'),toast:$('#toast')
};

function init(){
  socket=io({reconnection:true});
  socket.on('connect',()=>dom.connectionBadge.textContent='🟢 服务运行中');
  socket.on('disconnect',()=>dom.connectionBadge.textContent='🔴 连接断开');
  socket.on('new-video',()=>{loadVideos();loadStats();});

  dom.searchBtn.onclick=()=>{currentPage=1;loadVideos();};
  dom.clearSearchBtn.onclick=()=>{dom.searchInput.value='';dom.dateFrom.value='';dom.dateTo.value='';currentPage=1;loadVideos();};
  dom.searchInput.onkeydown=e=>{if(e.key==='Enter'){currentPage=1;loadVideos();}};
  dom.prevPageBtn.onclick=()=>{if(currentPage>1){currentPage--;loadVideos();}};
  dom.nextPageBtn.onclick=()=>{currentPage++;loadVideos();};
  dom.closePlayer.onclick=closePlayer;
  dom.playerModal.onclick=e=>{if(e.target===dom.playerModal)closePlayer();};
  dom.copyTrackingBtn.onclick=()=>{if(currentVideo){navigator.clipboard.writeText(currentVideo.tracking_number);toast('单号已复制');}};
  dom.deleteVideoBtn.onclick=deleteCurrent;
  dom.selectAll.onchange=toggleSelectAll;
  dom.batchDownloadBtn.onclick=batchDownload;
  dom.batchDeleteBtn.onclick=batchDelete;

  loadVideos();loadStats();
}

function closePlayer(){dom.playerModal.classList.add('hidden');dom.playerVideo.pause();currentVideo=null;}

async function loadVideos(){
  const p=new URLSearchParams({page:currentPage,limit:50,search:dom.searchInput.value,dateFrom:dom.dateFrom.value,dateTo:dom.dateTo.value});
  try{
    const r=await fetch('/api/videos?'+p);const d=await r.json();
    dom.videoList.querySelectorAll('.video-card').forEach(c=>c.remove());
    selectedVideos.clear();dom.selectAll.checked=false;
    if(d.videos.length===0){dom.emptyState.classList.remove('hidden');dom.pagination.classList.add('hidden');dom.searchResult.textContent='';}
    else{
      dom.emptyState.classList.add('hidden');dom.pagination.classList.remove('hidden');
      dom.searchResult.textContent='共 '+d.total+' 条';dom.pageInfo.textContent='第 '+d.page+' / '+d.totalPages+' 页';
      dom.prevPageBtn.disabled=d.page<=1;dom.nextPageBtn.disabled=d.page>=d.totalPages;
      d.videos.forEach(v=>{
        const card=document.createElement('div');card.className='video-card';
        card.innerHTML=`<div class="video-card-thumb" data-id="${v.id}"><div class="play-icon">▶</div><input type="checkbox" class="video-check" data-id="${v.id}" style="position:absolute;top:8px;left:8px;z-index:5;width:18px;height:18px"></div>
          <div class="video-card-body"><div class="video-card-tracking">${v.tracking_number}</div>
          <div class="video-card-meta"><span>${v.record_date} ${v.record_time}</span><span>${fmt(v.file_size)}</span></div>
          <div class="video-card-tags"><span class="tag tag-${v.upload_method}">${v.upload_method}</span></div></div>`;
        card.querySelector('.video-card-thumb').addEventListener('click',e=>{
          if(e.target.tagName==='INPUT')return;openPlayer(v);
        });
        card.querySelector('.video-check').onchange=function(){if(this.checked)selectedVideos.add(v.id);else selectedVideos.delete(v.id);};
        dom.videoList.appendChild(card);
      });
    }
  }catch(e){dom.emptyState.classList.remove('hidden');}
}

function openPlayer(v){
  currentVideo=v;dom.playerModal.classList.remove('hidden');
  dom.playerTitle.textContent='单号: '+v.tracking_number;
  dom.playerInfo.innerHTML=`日期: ${v.record_date} ${v.record_time} | 大小: ${fmt(v.file_size)} | 上传: ${v.upload_method}`;
  dom.playerVideo.src='/uploads/'+v.file_path;dom.playerVideo.load();
  dom.downloadVideoBtn.href='/api/download?file='+encodeURIComponent(v.file_path)+'&name='+encodeURIComponent(v.tracking_number+'.mp4');
}

async function deleteCurrent(){
  if(!currentVideo||!confirm('删除 '+currentVideo.tracking_number+'?'))return;
  await fetch('/api/videos/'+currentVideo.id,{method:'DELETE'});toast('已删除');
  closePlayer();loadVideos();loadStats();
}

async function loadStats(){
  try{const r=await fetch('/api/stats');const d=await r.json();
    dom.statTotal.textContent=d.total?.count||0;dom.statSize.textContent=fmt(d.total?.size||0);
    const today=new Date().toISOString().slice(0,10);dom.statToday.textContent=(d.byDate||[]).find(x=>x.record_date===today)?.count||0;
    dom.statFree.textContent=d.diskFreeGB?d.diskFreeGB+'GB':'--';}catch(e){}
}

function toggleSelectAll(){const checked=dom.selectAll.checked;dom.videoList.querySelectorAll('.video-check').forEach(cb=>{cb.checked=checked;if(checked)selectedVideos.add(parseInt(cb.dataset.id));else selectedVideos.delete(parseInt(cb.dataset.id));});}

function batchDownload(){
  if(selectedVideos.size===0){toast('请先勾选视频');return;}
  const ids=Array.from(selectedVideos);
  ids.forEach(id=>{
    fetch('/api/videos/'+id).then(r=>r.json()).then(v=>{
      const a=document.createElement('a');a.href='/api/download?file='+encodeURIComponent(v.file_path)+'&name='+encodeURIComponent(v.tracking_number+'.mp4');a.download=v.tracking_number+'.mp4';a.click();
    });
  });
  toast('开始下载 '+ids.length+' 个视频');
}

async function batchDelete(){
  if(selectedVideos.size===0){toast('请先勾选视频');return;}
  if(!confirm('确定删除 '+selectedVideos.size+' 个视频？此操作不可撤销。'))return;
  const r=await fetch('/api/videos/batch-delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:Array.from(selectedVideos)})});
  const d=await r.json();toast('已删除 '+d.deleted+' 个');loadVideos();loadStats();
}

function fmt(b){if(!b)return'0B';if(b<1024)return b+'B';if(b<1048576)return(b/1024).toFixed(1)+'KB';if(b<1073741824)return(b/1048576).toFixed(1)+'MB';return(b/1073741824).toFixed(1)+'GB';}
function toast(msg){const t=dom.toast;t.textContent=msg;t.classList.remove('hidden');setTimeout(()=>t.classList.add('hidden'),3000);}
init();
