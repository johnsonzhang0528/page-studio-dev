import https from 'node:https';

const fail=(message,code=message)=>Object.assign(new Error(message),{code});
const ascii=value=>typeof value==='string'&&/^[\x21-\x7E]{1,512}$/.test(value);

export function createOpenAiTlsTransport({apiKey,request=https.request,Agent=https.Agent,create_connection=null,max_response_bytes=1048576,absolute_timeout_ms=120000}={}){
  const key=Buffer.isBuffer(apiKey)?apiKey.toString('utf8').trim():String(apiKey??'').trim();
  if(!key||typeof request!=='function'||typeof Agent!=='function'||(create_connection!==null&&typeof create_connection!=='function')||!Number.isSafeInteger(max_response_bytes)||max_response_bytes<1024||max_response_bytes>8388608||!Number.isSafeInteger(absolute_timeout_ms)||absolute_timeout_ms<1000||absolute_timeout_ms>600000)throw fail('BILLING_EGRESS_TLS_CONFIG_INVALID','BILLING_EGRESS_CONFIG_INVALID');
  return async function dispatch(input={}){
    if(input.hostname!=='api.openai.com'||input.port!==443||input.servername!=='api.openai.com'||input.minimum_tls!=='TLSv1.2'||input.method!=='POST'||input.path!=='/v1/responses'||input.redirects!==0||input.retries!==0||!Buffer.isBuffer(input.body)||!ascii(input.request_id))throw fail('BILLING_EGRESS_TLS_SCOPE_INVALID');
    return new Promise((resolve,reject)=>{
      let settled=false,responseBytes=0,deadline=null,requestHandle=null;const chunks=[];
      const agent=new Agent({keepAlive:false,maxSockets:1,maxFreeSockets:0});
      if(create_connection)agent.createConnection=create_connection;
      const finish=(error,value)=>{if(settled)return;settled=true;if(deadline)clearTimeout(deadline);agent.destroy?.();error?reject(error):resolve(value);};
      try{requestHandle=request({
        protocol:'https:',hostname:'api.openai.com',port:443,servername:'api.openai.com',method:'POST',path:'/v1/responses',minVersion:'TLSv1.2',
        headers:{authorization:`Bearer ${key}`,'content-type':'application/json','content-length':input.body.length,'x-client-request-id':input.request_id},
        agent,setHost:true
      },response=>{
        response.on('data',chunk=>{responseBytes+=chunk.length;if(responseBytes>max_response_bytes){requestHandle.destroy();finish(fail('BILLING_EGRESS_TLS_RESPONSE_TOO_LARGE'));return;}chunks.push(chunk);});
        response.on('error',()=>finish(fail('BILLING_EGRESS_TLS_RESPONSE_FAILED')));
        response.on('end',()=>{
          const providerRequestId=String(response.headers?.['x-request-id']??'');
          if(!ascii(providerRequestId))return finish(fail('BILLING_EGRESS_PROVIDER_REQUEST_ID_MISSING'));
          finish(null,{status:Number(response.statusCode),headers:{'content-type':String(response.headers?.['content-type']??''),'x-request-id':providerRequestId},body:Buffer.concat(chunks),provider_request_id:providerRequestId,attempts:1});
        });
      });}catch{finish(fail('BILLING_EGRESS_TLS_REQUEST_FAILED'));return;}
      requestHandle.once('error',()=>finish(fail('BILLING_EGRESS_TLS_REQUEST_FAILED')));
      deadline=setTimeout(()=>{requestHandle.destroy();finish(fail('BILLING_EGRESS_TLS_DEADLINE','BILLING_EGRESS_TIMEOUT'));},absolute_timeout_ms);
      requestHandle.end(input.body);
    });
  };
}
