import http from 'node:http';
import path from 'node:path';

const fail=(message,code='BILLING_GATEWAY_CLIENT_DENIED')=>Object.assign(new Error(message),{code});
const allowedKeys=new Set(['credential','spec','spend_lease_id']);
const reserveKeys=new Set(['credential','spec','work_unit_budget_id','priority','canary_wave']);
const safeRemoteCodes=new Set(['BILLING_PROJECT_POLICY_MISSING','BILLING_POLICY_INVALID','BILLING_HARD_CAP','BILLING_PRIORITY_HOLD','GLOBAL_BILLING_HOLD','BILLING_IDENTITY_CONFLICT','BILLING_CONTROLLER_CREDENTIAL_FORMAT_INVALID','BILLING_CONTROLLER_CREDENTIAL_SIGNATURE_INVALID','BILLING_CONTROLLER_CREDENTIAL_PAYLOAD_INVALID','BILLING_CONTROLLER_CREDENTIAL_SCOPE_INVALID','BILLING_CONTROL_UNAVAILABLE','BILLING_EGRESS_DISABLED','BILLING_EGRESS_SCOPE_INVALID','BILLING_EGRESS_REQUEST_INVALID','BILLING_EGRESS_ASSERTION_INVALID','BILLING_EGRESS_ASSERTION_FORMAT_INVALID','BILLING_EGRESS_ASSERTION_SIGNATURE_INVALID','BILLING_EGRESS_ASSERTION_PAYLOAD_INVALID','BILLING_EGRESS_ASSERTION_SCOPE_INVALID','BILLING_EGRESS_ASSERTION_REPLAY','BILLING_EGRESS_TLS_SCOPE_INVALID','BILLING_EGRESS_TLS_REQUEST_FAILED','BILLING_EGRESS_TLS_RESPONSE_FAILED','BILLING_EGRESS_TLS_RESPONSE_TOO_LARGE','BILLING_EGRESS_PROVIDER_REQUEST_ID_MISSING','BILLING_EGRESS_TLS_DEADLINE','PROVIDER_UNAVAILABLE','MODEL_DRIFT_HOLD','OPENAI_EGRESS_RESPONSE_INVALID']);

export function createBillingGatewayUnixClient({socket_path='/run/page-autodev/billing-gateway.sock',request=http.request,max_wire_bytes=524288,timeout_ms=120000,allow_test_socket=false}={}){
  const production=socket_path==='/run/page-autodev/billing-gateway.sock';
  const test=allow_test_socket&&path.isAbsolute(socket_path)&&/^[A-Za-z0-9._/\\:-]+$/.test(socket_path);
  if((!production&&!test)||typeof request!=='function'||!Number.isSafeInteger(max_wire_bytes)||max_wire_bytes<1024||max_wire_bytes>1048576||!Number.isSafeInteger(timeout_ms)||timeout_ms<1000||timeout_ms>600000)throw fail('BILLING_GATEWAY_CLIENT_CONFIG_INVALID','BILLING_GATEWAY_CLIENT_CONFIG_INVALID');
  const send=(route,input,keys)=>{
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!keys.has(key))||typeof input.credential!=='string'||!input.credential||!input.spec)throw fail('BILLING_GATEWAY_CLIENT_ENVELOPE_INVALID');
    const payload=Buffer.from(JSON.stringify(input));if(payload.length>max_wire_bytes)throw fail('BILLING_GATEWAY_CLIENT_WIRE_TOO_LARGE');
    return new Promise((resolve,reject)=>{
      let settled=false,size=0,timer=null,handle=null;const chunks=[];
      const finish=(error,value)=>{if(settled)return;settled=true;if(timer)clearTimeout(timer);error?reject(error):resolve(value);};
      try{handle=request({socketPath:socket_path,path:route,method:'POST',headers:{'content-type':'application/json','content-length':payload.length},agent:false},response=>{
        response.on('data',chunk=>{size+=chunk.length;if(size>max_wire_bytes){handle.destroy();finish(fail('BILLING_GATEWAY_CLIENT_RESPONSE_TOO_LARGE'));return;}chunks.push(chunk);});
        response.on('error',error=>finish(fail(`BILLING_GATEWAY_CLIENT_RESPONSE_ERROR:${error.code??error.message}`)));
        response.on('end',()=>{let decoded;try{decoded=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return finish(fail('BILLING_GATEWAY_CLIENT_RESPONSE_INVALID'));}if(response.statusCode!==200||decoded?.ok!==true){const remoteCode=safeRemoteCodes.has(decoded?.code)?decoded.code:'BILLING_GATEWAY_CLIENT_REJECTED';return finish(fail(remoteCode,remoteCode==='BILLING_GATEWAY_CLIENT_REJECTED'?'BILLING_GATEWAY_CLIENT_DENIED':remoteCode));}finish(null,decoded.result);});
      });}catch(error){finish(fail(`BILLING_GATEWAY_CLIENT_REQUEST_ERROR:${error.code??error.message}`));return;}
      handle.once('error',error=>finish(fail(`BILLING_GATEWAY_CLIENT_REQUEST_ERROR:${error.code??error.message}`)));
      timer=setTimeout(()=>{handle.destroy();finish(fail('BILLING_GATEWAY_CLIENT_TIMEOUT','BILLING_GATEWAY_CLIENT_TIMEOUT'));},timeout_ms);
      handle.end(payload);
    });
  };
  return Object.freeze({socket_path,async reserve(input={}){if(typeof input.work_unit_budget_id!=='string'||!input.work_unit_budget_id)throw fail('BILLING_GATEWAY_CLIENT_ENVELOPE_INVALID');return send('/v1/reserve',input,reserveKeys);},async dispatch(input={}){if(typeof input.spend_lease_id!=='string'||!input.spend_lease_id)throw fail('BILLING_GATEWAY_CLIENT_ENVELOPE_INVALID');return send('/v1/dispatch',input,allowedKeys);}});
}
