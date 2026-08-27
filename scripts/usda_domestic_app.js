/* 축산레이더 · 미국 축산물 내수 현황 / USDA AMS LM_PK602 */
window.UsdaDomesticApp = (function () {
  const { useState, useEffect, useMemo } = React;
  const C={bg:'#151312',panel:'#1d1a19',border:'#2b2624',amber:'#d98b3f',amberSoft:'#e8b877',cream:'#f2ead9',mute:'#8f857a',sage:'#6f9482',rust:'#c2695f'};
  const ITEMS=[{key:'Bnls CC Strap-off',label:'등심'},{key:'Picnic Cushion Meat Vac',label:'전지'},{key:'1/4 Trim Bnls Butt VAC',label:'목전지'}];
  const money=v=>Number(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const date=s=>s?String(s).replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$1.$2.$3'):'—';
  const pct=(a,b)=>{a=Number(a);b=Number(b);return Number.isFinite(a)&&Number.isFinite(b)&&b!==0?`${a>=b?'+':''}${((a-b)/b*100).toFixed(1)}%`:'—';};
  function Chart({rows}){
    const W=900,H=330,P={l:58,r:18,t:24,b:44},iw=W-P.l-P.r,ih=H-P.t-P.b;
    const vals=rows.flatMap(r=>ITEMS.map(i=>Number(r[i.key]?.usdPerLb)).filter(Number.isFinite));
    if(!vals.length)return React.createElement('div',{style:{padding:40,textAlign:'center',color:C.mute}},'차트 데이터가 없습니다.');
    const lo=Math.min(...vals)*.95,hi=Math.max(...vals)*1.05,span=Math.max(.01,hi-lo),x=i=>P.l+(rows.length<2?iw/2:i*iw/(rows.length-1)),y=v=>P.t+ih-(v-lo)/span*ih;
    const colors=[C.amber,C.sage,'#4f8fb8'];
    return React.createElement('div',{style:{overflowX:'auto'}},React.createElement('svg',{viewBox:`0 0 ${W} ${H}`,style:{width:'100%',minWidth:620,height:H,display:'block'}},
      Array.from({length:5},(_,i)=>{const v=lo+span*(4-i)/4,yy=y(v);return React.createElement('g',{key:i},React.createElement('line',{x1:P.l,x2:W-P.r,y1:yy,y2:yy,stroke:C.border,strokeDasharray:'3 3'}),React.createElement('text',{x:P.l-8,y:yy+4,textAnchor:'end',fontSize:10,fill:C.mute},`$${v.toFixed(2)}`));}),
      rows.map((r,i)=>i%Math.max(1,Math.ceil(rows.length/10))===0?React.createElement('text',{key:r.date,x:x(i),y:H-12,textAnchor:'middle',fontSize:9,fill:C.mute},r.date.slice(5)):null),
      ITEMS.map((item,j)=>{const d=rows.map((r,i)=>{const v=Number(r[item.key]?.usdPerLb);return Number.isFinite(v)?`${i?'L':'M'}${x(i)},${y(v)}`:''}).filter(Boolean).join(' ');return React.createElement('path',{key:item.key,d,fill:'none',stroke:colors[j],strokeWidth:2.5});}),
      rows.length<=90&&ITEMS.flatMap((item,j)=>rows.map((r,i)=>{const v=Number(r[item.key]?.usdPerLb);return Number.isFinite(v)?React.createElement('circle',{key:`${j}-${i}`,cx:x(i),cy:y(v),r:2.5,fill:colors[j]}):null;}))
    ),React.createElement('div',{style:{display:'flex',gap:16,flexWrap:'wrap',marginTop:6,fontSize:11,color:C.cream}},ITEMS.map((i,j)=>React.createElement('span',{key:i.key,style:{color:colors[j]}},`● ${i.label}`))));
  }
  function Card({item,cur,prev,week}){const v=cur?.[item.key]?.usdPerLb;return React.createElement('div',{style:{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:'14px 16px'}},React.createElement('div',{style:{fontSize:12,color:C.mute}},item.label),React.createElement('div',{style:{fontSize:'clamp(22px,5vw,30px)',fontWeight:800,color:C.amberSoft,fontFamily:'ui-monospace,monospace',marginTop:4}},v==null?'—':`$${money(v)}/lb`),React.createElement('div',{style:{fontSize:10,color:C.mute,marginTop:4}},v==null?'데이터 없음':`$${money(v*100)} / 100 lb · Wtd Avg`),React.createElement('div',{style:{display:'flex',gap:12,marginTop:9,fontSize:10.5}},React.createElement('span',{style:{color:C.mute}},`전일 ${pct(v,prev?.[item.key]?.usdPerLb)}`),React.createElement('span',{style:{color:C.mute}},`전주 ${pct(v,week?.[item.key]?.usdPerLb)}`)));}
  function App(){
    const [db,setDb]=useState(null),[err,setErr]=useState(null),[days,setDays]=useState(90),[tab,setTab]=useState('chart');
    useEffect(()=>{fetch('./data/usda_pork_domestic.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error(`데이터 파일 오류 (${r.status})`);return r.json();}).then(setDb).catch(e=>setErr(e.message));},[]);
    const rows=useMemo(()=>db?.data?[...db.data].sort((a,b)=>a.date.localeCompare(b.date)).slice(-days):[],[db,days]);
    if(err)return React.createElement('div',{style:{background:C.bg,color:C.rust,minHeight:'100vh',padding:30}},`미국 축산물 내수 현황 오류: ${err}`);
    if(!db)return React.createElement('div',{style:{background:C.bg,color:C.mute,minHeight:'100vh',padding:40,textAlign:'center'}},'USDA 내수 데이터를 불러오는 중…');
    const cur=rows[rows.length-1],prev=rows[rows.length-2],week=rows[Math.max(0,rows.length-6)];
    return React.createElement('div',{style:{background:C.bg,color:C.cream,minHeight:'100vh',padding:'20px 16px 40px'}},React.createElement('div',{style:{maxWidth:1120,margin:'0 auto'}},
      React.createElement('div',{style:{fontSize:11,color:C.mute,fontWeight:700,letterSpacing:'.12em'}},'USDA AMS · LM_PK602 · NATIONAL DAILY PORK FOB PLANT'),
      React.createElement('h1',{style:{fontSize:'clamp(22px,5vw,28px)',margin:'5px 0 4px'}},'미국 축산물 내수 현황'),
      React.createElement('div',{style:{fontSize:11,color:C.mute,marginBottom:14}},'돼지고기 주요 부위 · Wtd Avg · USD/100 lb → USD/lb'),
      React.createElement('div',{style:{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:8,marginBottom:12}},ITEMS.map(i=>React.createElement(Card,{key:i.key,item:i,cur,prev,week}))),
      React.createElement('div',{style:{background:C.panel,border:`1px solid ${C.border}`,borderRadius:10,padding:'10px 14px',marginBottom:12,fontSize:11,color:C.mute}},`최근 발표 ${date(cur?.date)} · USDA AMS MyMarketNews · PK602`),
      React.createElement('div',{style:{display:'flex',gap:4,borderBottom:`1px solid ${C.border}`,marginBottom:10}},['chart','table'].map(v=>React.createElement('button',{key:v,onClick:()=>setTab(v),style:{padding:'9px 16px',background:'none',border:'none',borderBottom:`2px solid ${tab===v?C.amber:'transparent'}`,color:tab===v?C.amber:C.mute,fontWeight:700,cursor:'pointer'}},v==='chart'?'차트':'표'))),
      tab==='chart'&&React.createElement(React.Fragment,null,React.createElement('div',{style:{display:'flex',justifyContent:'flex-end',gap:5,marginBottom:8}},[30,90,180].map(d=>React.createElement('button',{key:d,onClick:()=>setDays(d),style:{padding:'5px 10px',background:C.panel,border:`1px solid ${days===d?C.amber:C.border}`,borderRadius:7,color:days===d?C.amber:C.mute,cursor:'pointer'}},`${d}일`))),React.createElement('div',{style:{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:16}},React.createElement(Chart,{rows})),React.createElement('div',{style:{fontSize:10.5,color:C.mute,marginTop:10}},'※ USDA 원자료 Wtd Avg는 $/100 lb입니다. 예: $145.00/100 lb = $1.45/lb.')),
      tab==='table'&&React.createElement('div',{style:{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,overflow:'auto',maxHeight:560}},React.createElement('table',{style:{width:'100%',borderCollapse:'collapse',fontSize:12}},React.createElement('thead',null,React.createElement('tr',null,['발표일',...ITEMS.map(i=>`${i.label} Wtd Avg ($/lb)`)].map((h,i)=>React.createElement('th',{key:h,style:{padding:9,textAlign:i?'right':'left',color:C.mute,background:'#141211',position:'sticky',top:0}},h)))),React.createElement('tbody',null,[...rows].reverse().map(r=>React.createElement('tr',{key:r.date},React.createElement('td',{style:{padding:8}},date(r.date)),ITEMS.map(i=>React.createElement('td',{key:i.key,style:{padding:8,textAlign:'right',color:C.amberSoft}},r[i.key]?.usdPerLb==null?'—':`$${money(r[i.key].usdPerLb)}`))))))),
      React.createElement('div',{style:{marginTop:16,paddingTop:10,borderTop:`1px solid ${C.border}`,fontSize:10.5,color:C.mute,lineHeight:1.7}},'자료: USDA Agricultural Marketing Service · MyMarketNews · LM_PK602 (Slug ID 2498) · 등심 / 전지 / 목전지')
    ));
  }
  return App;
})();
