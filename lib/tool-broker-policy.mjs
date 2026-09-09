import fs from 'node:fs';
import path from 'node:path';

const fail=(message,code='TOOL_BROKER_DENIED')=>Object.assign(new Error(message),{code});
const shellPrograms=new Set(['git','node','npm','npx','pnpm','yarn','pytest','python','python3','cargo','go','docker']);
const dangerousGit=new Set(['push','reset','clean','checkout','switch','rebase','merge','cherry-pick','commit','tag']);
const dangerousDocker=new Set(['push','login','logout','system','volume','network']);

export function createToolBrokerPolicy({project,read_scope=['.'],write_scope=[],shell_argv=[],mode='read_only'}={}){
  const root=fs.realpathSync(project),rootPrefix=root+path.sep;
  const resolve=(relative,{mustExist=true}={})=>{
    if(typeof relative!=='string'||!relative||path.isAbsolute(relative))throw fail('TOOL_PATH_INVALID');
    const parts=relative.replaceAll('\\','/').split('/');if(parts.some(part=>!part||part==='.'||part==='..'))throw fail('TOOL_PATH_TRAVERSAL');
    const candidate=path.resolve(root,...parts);if(candidate!==root&&!candidate.startsWith(rootPrefix))throw fail('TOOL_PATH_ESCAPE');
    const ancestor=mustExist?candidate:path.dirname(candidate),resolved=fs.realpathSync(ancestor);if(resolved!==root&&!resolved.startsWith(rootPrefix))throw fail('TOOL_SYMLINK_ESCAPE');
    if(mustExist&&fs.lstatSync(candidate).isSymbolicLink())throw fail('TOOL_SYMLINK_DENIED');return candidate;
  };
  const scoped=(relative,scopes)=>scopes.some(scope=>scope==='.'||relative===scope||relative.startsWith(`${scope.replace(/\/$/,'')}/`));
  const normalizedRead=read_scope.map(value=>String(value).replaceAll('\\','/').replace(/^\.\//,'')),normalizedWrite=write_scope.map(value=>String(value).replaceAll('\\','/').replace(/^\.\//,''));
  const allowedCommands=new Set(shell_argv.map(argv=>{if(!Array.isArray(argv)||!argv.length||argv.some(value=>typeof value!=='string'||/[\0\r\n]/.test(value)))throw fail('TOOL_SHELL_POLICY_INVALID');return JSON.stringify(argv);}));
  return Object.freeze({
    authorizeRead(relative){const normalized=relative.replaceAll('\\','/');if(!scoped(normalized,normalizedRead))throw fail('TOOL_READ_SCOPE_DENIED');return resolve(normalized);},
    authorizeWrite(relative){if(mode==='read_only')throw fail('TOOL_WRITE_READ_ONLY');const normalized=relative.replaceAll('\\','/');if(!scoped(normalized,normalizedWrite))throw fail('TOOL_WRITE_SCOPE_DENIED');return resolve(normalized,{mustExist:fs.existsSync(path.resolve(root,normalized))});},
    authorizeShell(argv){if(!Array.isArray(argv)||!argv.length||argv.some(value=>typeof value!=='string'||/[\0\r\n]/.test(value)))throw fail('TOOL_SHELL_ARGV_INVALID');const program=path.basename(argv[0]).replace(/\.exe$/i,'');if(!shellPrograms.has(program))throw fail('TOOL_SHELL_PROGRAM_DENIED');if(program==='git'&&dangerousGit.has(argv[1]))throw fail('TOOL_SHELL_MUTATION_DENIED');if(program==='docker'&&dangerousDocker.has(argv[1]))throw fail('TOOL_SHELL_MUTATION_DENIED');if(!allowedCommands.has(JSON.stringify(argv)))throw fail('TOOL_SHELL_COMMAND_NOT_DECLARED');return [...argv];},
    authorizeNetwork(){throw fail('TOOL_NETWORK_DENIED');},root,mode
  });
}
