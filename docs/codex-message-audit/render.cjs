const fs = require('fs');
const path = require('path');
const source = path.join(__dirname, '../リマインダー・フォローメッセージ_送信動作監査レポート_Codex.md');
const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const inline = s => esc(s).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g,'<a href="$2">$1</a>');
const lines = fs.readFileSync(source,'utf8').split(/\r?\n/);
let html='', code=null, table=false, list=false;
function close(){ if(table){html+='</tbody></table>';table=false;} if(list){html+='</ol>';list=false;} }
for(const line of lines){
 if(line.startsWith('```')){ if(code!==null){html+='<pre>'+esc(code.join('\n'))+'</pre>';code=null;}else{close();code=[];}continue; }
 if(code!==null){code.push(line);continue;}
 if(line.startsWith('|')){
  if(/^\|[-| :]+\|$/.test(line))continue;
  const cells=line.slice(1,-1).split('|');
  if(!table){close();html+='<table><thead><tr>'+cells.map(c=>'<th>'+inline(c.trim())+'</th>').join('')+'</tr></thead><tbody>';table=true;}
  else html+='<tr>'+cells.map(c=>'<td>'+inline(c.trim())+'</td>').join('')+'</tr>';
  continue;
 }
 if(/^\d+\. /.test(line)){if(!list){close();html+='<ol>';list=true;}html+='<li>'+inline(line.replace(/^\d+\. /,''))+'</li>';continue;}
 close();if(!line.trim())continue;
 const h=line.match(/^(#{1,3}) (.*)$/);html+=h?`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`:'<p>'+inline(line)+'</p>';
}
close();
fs.writeFileSync(path.join(__dirname,'report.html'),`<!doctype html><html lang="ja"><meta charset="utf-8"><title>予約リマインダー・フォローメッセージ監査 | Codex</title><style>
@page{size:A4;margin:17mm 16mm 18mm}*{box-sizing:border-box}body{font-family:'Yu Gothic','Meiryo',sans-serif;color:#243244;font-size:9.4pt;line-height:1.7;margin:0}h1{font-size:22pt;line-height:1.45;color:#153c5b;margin:8mm 0 6mm;border-bottom:3px solid #27798b;padding-bottom:6mm}h2{font-size:16pt;color:#153c5b;border-bottom:1px solid #adc4cd;margin:9mm 0 4mm;break-after:avoid}h3{font-size:11.5pt;color:#15596c;margin:6mm 0 3mm;break-after:avoid}p{margin:2.7mm 0;orphans:3;widows:3}strong{font-weight:700}table{width:100%;border-collapse:collapse;margin:4mm 0;font-size:8.5pt;table-layout:fixed}th,td{border:1px solid #c6d5dc;padding:2mm 2.4mm;vertical-align:top;overflow-wrap:anywhere}th{background:#eaf1f5;color:#163f59;text-align:left}th:first-child,td:first-child{width:30%}thead{display:table-header-group}tr{break-inside:avoid}pre{background:#f1f4f6;border-left:3px solid #448698;padding:3mm;font:8pt/1.55 Consolas,'Yu Gothic',monospace;white-space:pre-wrap;overflow-wrap:anywhere}code{font:8.4pt Consolas,'Yu Gothic',monospace;overflow-wrap:anywhere}a{color:#176377;text-decoration:underline;overflow-wrap:anywhere}li{margin:2mm 0}ol{padding-left:6mm}h2:not(:first-of-type){break-before:auto}
</style><body>${html}</body></html>`);
console.log('Rendered '+lines.length+' Markdown lines to report.html');
