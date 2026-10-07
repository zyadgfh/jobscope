function createSourceDocument({sourceId,url,title='',content='',retrievedAt=new Date().toISOString(),contentType='text/html'}){
 if(!sourceId||!url)throw new Error('sourceId and url are required');
 return {id:'doc_'+Buffer.from(url).toString('base64url').slice(0,40),sourceId,url,title,content,contentType,retrievedAt,provenance:{retrievalMethod:'http',url}};
}
module.exports={createSourceDocument};
