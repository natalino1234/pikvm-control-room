(function(root) {
  function pointer(x, y, box, image, fit = 'contain') {
    let width=box.width,height=box.height,left=box.left,top=box.top;
    if(fit==='contain') {
      const scale=Math.min(width/image.width,height/image.height);
      width=image.width*scale;height=image.height*scale;
      left+=(box.width-width)/2;top+=(box.height-height)/2;
    }
    if(x<left||y<top||x>left+width||y>top+height||width<=0||height<=0)return null;
    return {x:Math.round((x-left)/width*65535-32768),y:Math.round((y-top)/height*65535-32768)};
  }
  if(typeof module!=='undefined')module.exports={pointer};else root.kvmGeometry={pointer};
})(globalThis);
