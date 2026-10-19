(function(root){
 'use strict';
 function pageItems(items,{page=0,size=6}={}){size=Number.isSafeInteger(size)&&size>0?size:6;const pages=Math.max(1,Math.ceil(items.length/size));page=Math.min(pages-1,Math.max(0,Number.isSafeInteger(page)?page:0));return{items:items.slice(page*size,(page+1)*size),page,pages,total:items.length};}
 root.NavrangPages={pageItems};
 if(typeof module==='object'&&module.exports)module.exports=root.NavrangPages;
})(globalThis);
