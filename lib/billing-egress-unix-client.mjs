import http from 'node:http';
import path from 'node:path';

const fail=(message,code='BILLING_EGRESS_CLIENT_DENIED')=>Object.assign(new Error(message),{code});
const envelopeKeys=new Set(['gateway_assertion','request_id','method','path','model_snapshot','body','body_sha256']);
const safeRemoteCodes=new Set(['BILLING_EGRESS_DISABLED','BILLING_EGRESS_ENVELOPE_INVALID','BILLING_EGRESS_SCOPE_INVALID','BILLING_EGRESS_REQUEST_INVALID','BILLING_EGRESS_ASSERTION_INVALID','BILLING_EGRESS_ASSERTION_FORMAT_INVALID','BILLING_EGRESS_ASSERTION_SIGNATURE_INVALID','BILLING_EGRESS_ASSERTION_PAYLOAD_INVALID','BILLING_EGRESS_ASSERTION_SCOPE_INVALID','BILLING_EGRESS_ASSERTION_REPLAY','BILLING_EGRESS_TLS_SCOPE_INVALID','BILLING_EGRESS_TLS_REQUEST_FAILED','BILLING_EGRESS_TLS_RESPONSE_FAILED','BILLING_EGRESS_TLS_RESPONSE_TOO_LARGE','BILLING_EGRESS_PROVIDER_REQUEST_ID_MISSING','BILLING_EGRESS_TLS_DEADLINE']);

export function createBillingEgressUnixClient({socket_path='/run/page-autodev/openai-egress.sock',request=http.request,max_wire_bytes=524288,timeout_ms=30000,allow_test_socket=false}={}){
  const productionSocket=socket_path==='/run/page-autodev/openai-egress.sock';
  const testSocket=allow_test_socket&&path.isAbsolute(socket_path)&&/^[A-Za-z0-9._/\\:-]+$/.test(socket_path);
  if((!productionSocket&&!testSocket)||typeof request!=='function'||!Number.isSafeInteger(max_wire_bytes)||max_wire_bytes<1024||max_wire_bytes>1048576||!Number.isSafeInteger(timeout_ms)||timeout_ms<1000||timeout_ms>120000)throw fail('BILLING_EGRESS_CLIENT_CONFIG_INVALID','BILLING_EGRESS_CONFIG_INVALID');
  return Object.freeze({
    async dispatch(input={}){
      if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!envelopeKeys.has(key))||!Buffer.isBuffer(input.body))throw fail('BILLING_EGRESS_CLIENT_ENVELOPE_INVALID');
      const wire={...input,body:undefined,body_base64:input.body.toString('base64')};delete wire.body;
      const payload=Buffer.from(JSON.stringify(wire));if(payload.length>max_wire_bytes)throw fail('BILLING_EGRESS_CLIENT_WIRE_TOO_LARGE');
      return new Promise((resolve,reject)=>{
        let settled=false,size=0,timer=null,handle=null;const chunks=[];
        const finish=(error,value)=>{if(settled)return;settled=true;if(timer)clearTimeout(timer);error?reject(error):resolve(value);};
        try{handle=request({socketPath:socket_path,path:'/dispatch',method:'POST',headers:{'content-type':'application/json','content-length':payload.length},agent:false},response=>{
          response.on('data',chunk=>{size+=chunk.length;if(size>max_wire_bytes){handle.destroy();finish(fail('BILLING_EGRESS_CLIENT_RESPONSE_TOO_LARGE'));return;}chunks.push(chunk);});
          response.on('error',error=>finish(fail(`BILLING_EGRESS_CLIENT_RESPONSE_ERROR:${error.code??error.message}`)));
          response.on('end',()=>{let decoded;try{decoded=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return finish(fail('BILLING_EGRESS_CLIENT_RESPONSE_INVALID'));}if(response.statusCode!==200||decoded?.ok!==true){const remoteCode=safeRemoteCodes.has(decoded?.code)?decoded.code:'BILLING_EGRESS_CLIENT_REJECTED';return finish(fail(remoteCode,remoteCode==='BILLING_EGRESS_CLIENT_REJECTED'?'BILLING_EGRESS_CLIENT_DENIED':remoteCode));}finish(null,decoded.result);});
        });}catch(error){finish(fail(`BILLING_EGRESS_CLIENT_REQUEST_ERROR:${error.code??error.message}`));return;}
        handle.once('error',error=>finish(fail(`BILLING_EGRESS_CLIENT_REQUEST_ERROR:${error.code??error.message}`)));
        timer=setTimeout(()=>{handle.destroy();finish(fail('BILLING_EGRESS_CLIENT_TIMEOUT','BILLING_EGRESS_TIMEOUT'));},timeout_ms);
        handle.end(payload);
      });
    },
    socket_path
  });
}
