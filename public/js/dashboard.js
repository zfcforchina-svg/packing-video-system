const $=s=>document.querySelector(s);let currentVideo=null,currentPage=1,selected=new Set();
const d={
  connBadge:$('#connBadge'),searchInput:$('#searchInput'),dateFrom:$('#dateFrom'),dateTo:$('#dateTo'),
  searchBtn:$('#searchBtn'),clearBtn:$('#clearBtn'),resultCount:$('#resultCount'),
  videoGrid:$('#videoGrid'),emptyState:$('#emptyState'),pagination:$('#pagination'),
  prevBtn:$('#prevBtn'),nextBtn:$('#nextBtn'),pageInfo:$('#pageInfo'),
  statTotal:$('#statTotal'),statSize:$('#statSize'),statToday:$('#statToday'),statFree:$('#statFree'),
  playerModal:$('#playerModal'),playerVideo:$('#playerVideo'),playerTitle:$('#playerTitle'),playerInfo:$('#playerInfo'),
  closePlayer:$('#closePlayer'),downloadBtn:$('#downloadBtn'),copyBtn:$('#copyBtn'),deleteBtn:$('#deleteBtn'),
  selectAll:$('#selectAll'),batchDownloadBtn:$('#batchDownloadBtn'),batchDeleteBtn:$('#batchDeleteBtn'),toast:$('#toast')
};
const socket=io({reconnection:true});
socket.on('connect',()=>d.connBadge.textContent='已连接');
socket.on('disconnect',()=>d.connBadge.textContent='未连接');
socket.on('new-video',()=>{loadV();loadS();});

d.searchBtn.onclick=()=>{currentPage=1;loadV();};
d.clearBtn.onclick=()=>{d.searchInput.value='';d.dateFrom.value='';d.dateTo.value='';currentPage=1;loadV();};
d.searchInput.onkeydown=e=>{if(e.key==='Enter'){currentPage=1;loadV();}};
d.prevBtn.onclick=()=>{if(currentPage>1){currentPage--;loadV();}};
d.nextBtn.onclick=()=>{currentPage++;loadV();};
d.closePlayer.onclick=()=>{d.playerModal.classList.add('hidden');d.playerVideo.pause();currentVideo=null;};
d.playerModal.onclick=e=>{if(e.target===d.playerModal){d.playerModal.classList.add('hidden');d.playerVideo.pause();}};
d.copyBtn.onclick=()=>{if(currentVideo){navigator.clipboard.writeText(currentVideo.tracking_number);t('已复制');}};
d.deleteBtn.onclick=async()=>{if(!currentVideo||!confirm('删除 '+currentVideo.tracking_number+'?'))return;await fetch('/api/videos/'+currentVideo.id,{method:'DELETE'});t('已删除');d.playerModal.classList.add('hidden');loadV();loadS();};
d.selectAll.onchange=()=>{const c=d.selectAll.checked;document.querySelectorAll('.video-check').forEach(cb=>{cb.checked=c;if(c)selected.add(+cb.dataset.id);else selected.delete(+cb.dataset.id);});};
d.batchDownloadBtn.onclick=()=>{if(!selected.size)return t('请勾选视频');[...selected].forEach(id=>{fetch('/api/videos/'+id).then(r=>r.json()).then(v=>{const a=document.createElement('a');a.href='/api/download?file='+encodeURIComponent(v.file_path)+'&name='+encodeURIComponent(v.tracking_number+'.mp4');a.click();});});t('下载中 '+selected.size+' 个');};
d.batchDeleteBtn.onclick=async()=>{if(!selected.size)return t('请勾选视频');if(!confirm('删除 '+selected.size+' 个？'))return;const r=await fetch('/api/videos/batch-delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[...selected]})});const j=await r.json();t('已删除 '+j.deleted);loadV();loadS();};

async function loadV(){
  const p=new URLSearchParams({page:currentPage,limit:50,search:d.searchInput.value,dateFrom:d.dateFrom.value,dateTo:d.dateTo.value});
  try{const r=await fetch('/api/videos?'+p);const j=await r.json();d.videoGrid.innerHTML='';selected.clear();d.selectAll.checked=false;
    if(!j.videos.length){d.emptyState.classList.remove('hidden');d.pagination.classList.add('hidden');d.resultCount.textContent='';}
    else{d.emptyState.classList.add('hidden');d.pagination.classList.remove('hidden');d.resultCount.textContent='共 '+j.total+' 条';d.pageInfo.textContent=j.page+' / '+j.totalPages;d.prevBtn.disabled=j.page<=1;d.nextBtn.disabled=j.page>=j.totalPages;
      j.videos.forEach(v=>{const c=document.createElement('div');c.className='video-card';c.innerHTML=`<div class="video-thumb"><div class="play">▶</div><input type="checkbox" class="check" data-id="${v.id}"></div><div class="video-info"><div class="video-tracking">${v.tracking_number}</div><div class="video-meta"><span>${v.record_date} ${v.record_time}</span><span>${f(v.file_size)}</span></div><div class="video-tag">${v.upload_method}</div></div>`;c.querySelector('.video-thumb').onclick=e=>{if(e.target.tagName!=='INPUT')P(v);};c.querySelector('.check').onchange=function(){this.checked?selected.add(+this.dataset.id):selected.delete(+this.dataset.id);};d.videoGrid.appendChild(c);});}
  }catch(e){d.emptyState.classList.remove('hidden');}
}

function P(v){currentVideo=v;d.playerModal.classList.remove('hidden');d.playerTitle.textContent=v.tracking_number;d.playerInfo.textContent=`${v.record_date} ${v.record_time}  |  ${f(v.file_size)}  |  ${v.upload_method}`;d.playerVideo.src='/uploads/'+v.file_path;d.playerVideo.load();d.downloadBtn.href='/api/download?file='+encodeURIComponent(v.file_path)+'&name='+encodeURIComponent(v.tracking_number+'.mp4');}

async function loadS(){try{const r=await fetch('/api/stats');const j=await r.json();d.statTotal.textContent=j.total?.count||0;d.statSize.textContent=f(j.total?.size||0);const today=new Date().toISOString().slice(0,10);d.statToday.textContent=(j.byDate||[]).find(x=>x.record_date===today)?.count||0;d.statFree.textContent=j.diskFreeGB?j.diskFreeGB+'GB':'--';}catch(e){}}
function f(b){if(!b)return'0B';if(b<1024)return b+'B';if(b<1048576)return(b/1024).toFixed(1)+'KB';if(b<1073741824)return(b/1048576).toFixed(1)+'MB';return(b/1073741824).toFixed(1)+'GB';}
function t(m){d.toast.textContent=m;d.toast.classList.remove('hidden');setTimeout(()=>d.toast.classList.add('hidden'),2500);}
loadV();loadS();
