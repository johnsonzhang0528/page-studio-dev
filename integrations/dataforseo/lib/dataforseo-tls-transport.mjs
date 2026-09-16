const HOST='api.dataforseo.com',PATHS=new Set(['/v3/dataforseo_labs/google/keyword_overview/live','/v3/dataforseo_labs/google/keyword_ideas/live','/v3/serp/google/organic/live/advanced']);
const fail=(message,code='DATAFORSEO_TLS_DENIED')=>Object.assign(new Error(message),{code});

function decodeChunked(body){
  const chunks=[];let offset=0;
  while(offset<body.length){
    const lineEnd=body.indexOf('\r\n',offset);if(lineEnd<0)throw fail('CHUNK_HEADER');
    const sizeText=body.subarray(offset,lineEnd).toString('ascii').split(';',1)[0];
    if(!/^[0-9a-fA-F]+$/.test(sizeText))throw fail('CHUNK_SIZE');
    const size=Number.parseInt(sizeText,16);offset=lineEnd+2;
    if(size===0)return Buffer.concat(chunks);
    if(offset+size+2>body.length||body.subarray(offset+size,offset+size+2).toString('ascii')!=='\r\n')throw fail('CHUNK_BODY');
    chunks.push(body.subarray(offset,offset+size));offset+=size+2;
  }
  throw fail('CHUNK_TERMINATOR');
}

function parseRawHttp(buffer,maxResponseBytes){
  const headerEnd=buffer.indexOf('\r\n\r\n');if(headerEnd<0)throw fail('HTTP_HEADERS');
  const lines=buffer.subarray(0,headerEnd).toString('latin1').split('\r\n');
  const match=(lines.shift()??'').match(/^HTTP\/1\.[01] (\d{3})(?: |$)/);if(!match)throw fail('HTTP_STATUS');
  const headers=new Map();for(const line of lines){const at=line.indexOf(':');if(at<1)throw fail('HTTP_HEADER');headers.set(line.slice(0,at).trim().toLowerCase(),line.slice(at+1).trim().toLowerCase());}
  let body=buffer.subarray(headerEnd+4);
  if(headers.get('transfer-encoding')?.split(',').map(value=>value.trim()).includes('chunked'))body=decodeChunked(body);
  else if(headers.has('content-length')){const length=Number(headers.get('content-length'));if(!Number.isSafeInteger(length)||length<0||body.length!==length)throw fail('CONTENT_LENGTH');}
  if(body.length>maxResponseBytes)throw fail('RESPONSE_TOO_LARGE');
  return {status:Number(match[1]),body,attempts:1};
}

function dispatchOverFixedTls({createConnection,input,auth,maxResponseBytes,timeoutMs}){
  return new Promise((resolve,reject)=>{
    let done=false,socket;const chunks=[];let size=0;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);socket?.destroy();error?reject(error):resolve(value);};
    const timer=setTimeout(()=>finish(fail('TIMEOUT','DATAFORSEO_TLS_TIMEOUT')),timeoutMs);
    try{createConnection({hostname:HOST,port:443,servername:HOST},(error,connected)=>{
      if(error)return finish(fail(`CONNECT:${error.code??'ERROR'}`));socket=connected;
      socket.once('error',event=>finish(fail(`REQUEST:${event.code??'ERROR'}`)));
      socket.on('data',chunk=>{size+=chunk.length;if(size>maxResponseBytes+65536)return finish(fail('RESPONSE_TOO_LARGE'));chunks.push(chunk);});
      socket.once('end',()=>{try{finish(null,parseRawHttp(Buffer.concat(chunks),maxResponseBytes));}catch(error){finish(error);}});
      const head=[`POST ${input.path} HTTP/1.1`,`Host: ${HOST}`,`Authorization: Basic ${auth}`,'Content-Type: application/json',`Content-Length: ${input.body.length}`,'Connection: close','',''].join('\r\n');
      socket.write(Buffer.concat([Buffer.from(head,'latin1'),input.body]));
    });}catch(error){finish(fail(`CONNECT:${error.code??'ERROR'}`));}
  });
}

export function createDataForSeoTlsTransport({login,password,request,create_connection,max_response_bytes=1048576,timeout_ms=90000}={}){
  if(!login||!password||(!request&&!create_connection))throw fail('CONFIG','DATAFORSEO_TLS_CONFIG_INVALID');
  const auth=Buffer.from(`${login}:${password}`).toString('base64');
  return input=>{
    if(input.hostname!==HOST||input.servername!==HOST||input.port!==443||input.minimum_tls!=='TLSv1.2'||input.method!=='POST'||!PATHS.has(input.path)||input.redirects!==0||input.retries!==0||!Buffer.isBuffer(input.body))return Promise.reject(fail('SCOPE'));
    if(!request)return dispatchOverFixedTls({createConnection:create_connection,input,auth,maxResponseBytes:max_response_bytes,timeoutMs:timeout_ms});
    return new Promise((resolve,reject)=>{let done=false,size=0,handle,timer;const chunks=[],agent={createConnection:create_connection,destroy(){}};const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);agent.destroy();error?reject(error):resolve(value);};try{handle=request({protocol:'http:',hostname:HOST,port:443,method:'POST',path:input.path,agent,setHost:true,headers:{host:HOST,authorization:`Basic ${auth}`,'content-type':'application/json','content-length':input.body.length}},response=>{response.on('data',chunk=>{size+=chunk.length;if(size>max_response_bytes){handle.destroy();finish(fail('RESPONSE_TOO_LARGE'));}else chunks.push(chunk);});response.on('error',event=>finish(fail(`RESPONSE:${event.code??'ERROR'}`)));response.on('end',()=>finish(null,{status:Number(response.statusCode),body:Buffer.concat(chunks),attempts:1}));});}catch(error){finish(fail(`REQUEST:${error.code??'ERROR'}`));return;}handle.once('error',event=>finish(fail(`REQUEST:${event.code??'ERROR'}`)));timer=setTimeout(()=>{handle.destroy();finish(fail('TIMEOUT','DATAFORSEO_TLS_TIMEOUT'));},timeout_ms);handle.end(input.body);});
  };
}
