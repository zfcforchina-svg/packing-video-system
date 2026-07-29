const app = getApp();
Page({
  data: {
    tracking:'',scanning:false,scanBtn:'扫码',
    videoPath:'',videoReady:false,uploading:false,done:false,
    connected:false,statusText:'准备就绪',fileName:''
  },
  onLoad(){
    wx.request({url:app.globalData.serverUrl+'/api/stats',
      success:()=>this.setData({connected:true,statusText:'已连接'}),
      fail:()=>this.setData({connected:false,statusText:'未连接'})
    });
  },
  onInput(e){this.setData({tracking:(e.detail.value||'').replace(/[^a-zA-Z0-9]/g,'')});},
  doScan(){
    this.setData({scanning:true,scanBtn:'扫描中...'});
    wx.scanCode({onlyFromCamera:true,scanType:['barCode','qrCode','datamatrix','pdf417'],
      success:(res)=>{const t=(res.result||'').replace(/[^a-zA-Z0-9]/g,'');this.setData({tracking:t,scanning:false,scanBtn:'重新扫码',statusText:'单号:'+t});wx.vibrateShort();},
      fail:()=>this.setData({scanning:false,scanBtn:'扫码'})
    });
  },
  doRecord(){
    if(!this.data.tracking)return wx.showToast({title:'请先输入单号',icon:'none'});
    wx.chooseVideo({camera:'back',maxDuration:60,sourceType:['camera','album'],
      success:(res)=>{this.setData({videoPath:res.tempFilePath,videoReady:true,fileName:this.data.tracking+'.mp4 ('+(res.size/1048576).toFixed(1)+'MB)',statusText:'录像完成'});},
      fail:(e)=>wx.showToast({title:'录像取消',icon:'none'})
    });
  },
  doUpload(){
    const t=this.data.tracking;if(!t||!this.data.videoPath)return;
    this.setData({uploading:true,statusText:'上传中...'});
    const task=wx.uploadFile({url:app.globalData.serverUrl+'/api/upload',filePath:this.data.videoPath,name:'video',formData:{trackingNumber:t},
      success:(res)=>{try{const d=JSON.parse(res.data);if(d.success)this.setData({uploading:false,done:true,statusText:'上传完成:'+t});else this.setData({uploading:false,statusText:'失败:'+(d.error||'')});}catch(e){this.setData({uploading:false,statusText:'失败'});}},
      fail:()=>this.setData({uploading:false,statusText:'上传失败'})
    });
    task.onProgressUpdate((res)=>{this.setData({statusText:'上传 '+res.progress+'%'});});
  },
  doNext(){this.setData({tracking:'',videoPath:'',videoReady:false,done:false,uploading:false,fileName:'',scanBtn:'扫码',statusText:this.data.connected?'准备就绪':'未连接'});}
});
