import { readFileSync, writeFileSync } from 'node:fs';
const source=readFileSync(new URL('../../../packages/shared/src/media-context-script.ts',import.meta.url),'utf8');
const body=source.match(/export const MEDIA_CONTEXT_SCRIPT = String\.raw`([\s\S]*)`;\s*$/)?.[1];
if(!body)throw Error('Shared media observer source was not found');
const target=new URL('../media-context.js',import.meta.url);
const generated='// Generated from packages/shared/src/media-context-script.ts. Do not edit.\n'+body.trim()+'\n';
if(process.argv.includes('--check')){if(readFileSync(target,'utf8')!==generated)throw Error('Run node scripts/sync-media-context.mjs before packaging');}
else writeFileSync(target,generated);
