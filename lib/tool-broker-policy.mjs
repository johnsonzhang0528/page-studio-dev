import fs from 'node:fs';
import path from 'node:path';

const fail=(message,code='TOOL_BROKER_DENIED')=>Object.assign(new Error(message),{code});
const shellPrograms=new Set(['git','node','npm','npx','pnpm','yarn','pytest','python','python3','cargo','go','docker']);
const dangerousGit=new Set(['push','reset','clean','checkout','switch','rebase','merge','cherry-pick','commit','tag']);
const dangerousDocker=new Set(['push','login','logout','system','volume','network']);
const protectedPaths=['.git','.env','.ai/PROJECT_STATE.json','.ai/PHASE_TASK_GRAPH.json','.ai/runtime/tool-broker'];

export function createToolBrokerPolicy({project,read_scope=['.'],write_scope=[],shell_argv=[],mode='read_only'}={}){
  const root=fs.realpathSync(project),rootPrefix=root+path.sep;
  const resolve=(relative,{mustExist=true}={})=>{
    if(typeof relative!=='string'||!relative||path.isAbsolute(relative))throw fail('TOOL_PATH_INVALID');
    const normalized=relative.replaceAll('\\','/');
    if(normalized==='.')return root;
    const parts=normalized.split('/');if(parts.some(part=>!part||part==='.'||part==='..'))throw fail('TOOL_PATH_TRAVERSAL');
    const candidate=path.resolve(root,...parts);if(candidate!==root&&!candidate.startsWith(rootPrefix))throw fail('TOOL_PATH_ESCAPE');
    let ancestor=mustExist?candidate:path.dirname(candidate);while(!fs.existsSync(ancestor)&&ancestor!==root)ancestor=path.dirname(ancestor);
    const resolved=fs.realpathSync(ancestor);if(resolved!==root&&!resolved.startsWith(rootPrefix))throw fail('TOOL_SYMLINK_ESCAPE');
    if(mustExist&&fs.lstatSync(candidate).isSymbolicLink())throw fail('TOOL_SYMLINK_DENIED');return candidate;
  };
  const scoped=(relative,scopes)=>scopes.some(scope=>scope==='.'||relative===scope||relative.startsWith(`${scope.replace(/\/$/,'')}/`));
  const protect=(relative)=>{const normalized=relative.toLowerCase();if(protectedPaths.some(value=>normalized===value.toLowerCase()||normalized.startsWith(`${value.toLowerCase()}/`))||/(^|\/)(?:[^/]*secret[^/]*|[^/]*credential[^/]*|\.env\.[^/]+)$/.test(normalized))throw fail('TOOL_PROTECTED_PATH_DENIED');};
  const normalizedRead=read_scope.map(value=>String(value).replaceAll('\\','/').replace(/^\.\//,'')),normalizedWrite=write_scope.map(value=>String(value).replaceAll('\\','/').replace(/^\.\//,''));
  const allowedCommands=new Set(shell_argv.map(argv=>{if(!Array.isArray(argv)||!argv.length||argv.some(value=>typeof value!=='string'||/[\0\r\n]/.test(value)))throw fail('TOOL_SHELL_POLICY_INVALID');return JSON.stringify(argv);}));
  return Object.freeze({
    authorizeRead(relative){if(typeof relative!=='string')throw fail('TOOL_PATH_INVALID');const normalized=relative.replaceAll('\\','/');protect(normalized);if(!scoped(normalized,normalizedRead))throw fail('TOOL_READ_SCOPE_DENIED');return resolve(normalized);},
    authorizeWrite(relative){if(mode==='read_only')throw fail('TOOL_WRITE_READ_ONLY');if(typeof relative!=='string')throw fail('TOOL_PATH_INVALID');const normalized=relative.replaceAll('\\','/');protect(normalized);if(!scoped(normalized,normalizedWrite))throw fail('TOOL_WRITE_SCOPE_DENIED');return resolve(normalized,{mustExist:fs.existsSync(path.resolve(root,normalized))});},
    authorizeMove(source,destination){if(mode==='read_only')throw fail('TOOL_WRITE_READ_ONLY');const from=this.authorizeRead(source),to=this.authorizeWrite(destination);if(from===root||to===root)throw fail('TOOL_MOVE_ROOT_DENIED');if(fs.existsSync(to))throw fail('TOOL_MOVE_DESTINATION_EXISTS');return Object.freeze({source:from,destination:to});},
    authorizeShell(argv){if(!Array.isArray(argv)||!argv.length||argv.some(value=>typeof value!=='string'||/[\0\r\n]/.test(value)))throw fail('TOOL_SHELL_ARGV_INVALID');const program=path.basename(argv[0]).replace(/\.exe$/i,'');if(!shellPrograms.has(program))throw fail('TOOL_SHELL_PROGRAM_DENIED');if(program==='git'&&dangerousGit.has(argv[1]))throw fail('TOOL_SHELL_MUTATION_DENIED');if(program==='docker'&&dangerousDocker.has(argv[1]))throw fail('TOOL_SHELL_MUTATION_DENIED');if(!allowedCommands.has(JSON.stringify(argv)))throw fail('TOOL_SHELL_COMMAND_NOT_DECLARED');return [...argv];},
    authorizeNetwork(){throw fail('TOOL_NETWORK_DENIED');},root,mode
  });
}
