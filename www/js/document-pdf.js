import { busy, toast } from './ui.js';

// Export the currently rendered, escaped document: one source of displayed facts
// for print and download. AutoTable paginates real text and repeats table headers.
export async function buildPDF(root) {
  if (!window.jspdf?.jsPDF) throw new Error('PDF library unavailable; reload the app.');
  const pdf = new window.jspdf.jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  const margin=12, width=186, bottom=282; let y=margin;
  let activeX=margin, activeWidth=width;
  const clean = value => value.replace(/→/g,' > ').replace(/—/g,'-').replace(/·/g,' / ').replace(/×/g,'x');
  function text(value,size=9,bold=false,x=activeX,w=activeWidth) {
    pdf.setFont('helvetica',bold?'bold':'normal'); pdf.setFontSize(size);
    const lines=pdf.splitTextToSize(clean(value.trim()),w);
    const height=size*0.45;
    for(const line of lines) {
      if(y+height>bottom) {pdf.addPage();y=margin;}
      pdf.text(line,x,y+height); y+=height;
    }
    y+=2;
  }
  function table(node) {
    const rows=section=>Array.from(node.querySelectorAll(`${section} > tr`)).map(row=>
      Array.from(row.children).map(cell=>({content:clean(cell.innerText.trim()),colSpan:cell.colSpan||1,
        styles:cell.classList.contains('num')?{halign:'right'}:{}})));
    const heads=Array.from(node.querySelectorAll('thead > tr:first-child > th'));
    const columnStyles={};
    heads.forEach((cell,n)=>{if(cell.style.width.endsWith('%'))columnStyles[n]={cellWidth:activeWidth*parseFloat(cell.style.width)/100};});
    pdf.autoTable({head:rows('thead'),body:rows('tbody'),foot:rows('tfoot'),startY:y,
      margin:{top:margin,right:210-activeX-activeWidth,bottom:15,left:activeX},tableWidth:activeWidth,columnStyles,
      theme:'grid',showHead:'everyPage',showFoot:'lastPage',rowPageBreak:'avoid',
      styles:{font:'helvetica',fontSize:8.5,cellPadding:2.1,overflow:'linebreak',lineColor:[220,220,225],lineWidth:0.15},
      headStyles:{fillColor:[241,244,248],textColor:[20,20,20],fontStyle:'bold'},
      didParseCell:({cell,row,section})=>{
        if(section==='body'&&node.querySelectorAll('tbody > tr')[row.index]?.classList.contains('tot')) cell.styles.fontStyle='bold';
      },
    });
    y=pdf.lastAutoTable.finalY+3;
  }
  async function header(node) {
    const co=node.querySelector('.co'), dt=node.querySelector('.dt');
    const img=new Image(); img.src='img/logo-brand.png'; await img.decode();
    const canvas=document.createElement('canvas'); canvas.width=img.naturalWidth; canvas.height=img.naturalHeight;
    canvas.getContext('2d').drawImage(img,0,0);
    const logoHeight=16*img.naturalHeight/img.naturalWidth;
    pdf.addImage(canvas.toDataURL('image/png'),'PNG',margin,y,16,logoHeight);
    const start=y;
    pdf.setTextColor(128,12,31);text(co.querySelector('b').innerText,11,true,margin+19,110);
    pdf.setTextColor(70,70,70);
    text(Array.from(co.querySelector('b').parentElement.children).filter(n=>n.tagName!=='B').map(n=>n.innerText).join('\n'),7.5,false,margin+19,110);
    const leftEnd=Math.max(y,start+logoHeight);
    y=start;pdf.setTextColor(128,12,31);text(dt.innerText,10,true,margin+132,54);
    pdf.setTextColor(20,20,20);y=Math.max(y,leftEnd)+2;
    pdf.setDrawColor(128,12,31);pdf.line(margin,y,198,y);y+=4;
  }
  async function walk(node) {
    if(node.classList?.contains('dh')) return header(node);
    if(node.classList?.contains('doc-top')) {
      const start=y;
      activeWidth=144;
      await walk(node.firstElementChild);const leftEnd=y;
      y=start;activeX=160;activeWidth=38;
      if(node.querySelector('.verify')) await walk(node.querySelector('.verify'));
      y=Math.max(y,leftEnd);activeX=margin;activeWidth=width;return;
    }
    if(node.classList?.contains('parties')) {
      const start=y;const x=activeX;const w=activeWidth;let end=y;
      for(const [n,column] of Array.from(node.children).entries()) {
        y=start;text(column.innerText,9,false,x+n*(w/2+2),w/2-4);end=Math.max(end,y);
      }
      y=end+2;return;
    }
    if(node.classList?.contains('verify')) {
      const svg=node.querySelector('svg');
      if(svg) {
        const img=new Image(); img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(svg));
        await img.decode();
        const canvas=document.createElement('canvas');canvas.width=300;canvas.height=300;
        canvas.getContext('2d').drawImage(img,0,0,300,300);
        if(y+25>bottom) {pdf.addPage();y=margin;}
        pdf.addImage(canvas.toDataURL('image/png'),'PNG',activeX,y,23,23);
        y+=25;
      }
      text(node.innerText,8);return;
    }
    if(node.tagName==='TABLE') return table(node);
    if(['P','H1','H2','H3','H4'].includes(node.tagName)) {
      if(/^H/.test(node.tagName) && y+18>bottom) {pdf.addPage();y=margin;}
      return text(node.innerText,node.tagName==='H2'?11:9,/^H/.test(node.tagName));
    }
    if(node.classList?.contains('payment-info')) {
      if(y+60>bottom) {pdf.addPage();y=margin;}
      text('PAYMENT INFORMATION',11,true);
      const start=y;
      let end=start;
      Array.from(node.querySelector('.payment-grid').children).forEach((column,n)=>{
        y=start; text(column.innerText,8.5,false,margin+n*62,59);end=Math.max(end,y);
      });
      y=end+3;return;
    }
    if(!node.children.length || node.classList?.contains('sig') || node.classList?.contains('foot') || node.classList?.contains('packing-summary')) return text(node.innerText,9);
    for(const child of node.children) await walk(child);
  }
  for(const node of root.children) await walk(node);
  const count=pdf.getNumberOfPages();
  for(let i=1;i<=count;i++) {pdf.setPage(i);pdf.setFontSize(8);pdf.setTextColor(100);pdf.text(`Horse Cargo / Page ${i} of ${count}`,198,290,{align:'right'});}
  return pdf;
}

export function wirePDF(el) {
  const btn=el.querySelector('#download-pdf'); if(!btn) return;
  btn.onclick=()=>busy(btn,async()=>{
    try {
      const root=el.querySelector('.doc'); const pdf=await buildPDF(root);
      const ref=root.querySelector('.dt .mono')?.textContent || 'Horse-Cargo';
      pdf.save(`${ref.replace(/[^\w-]/g,'_')}.pdf`);
    } catch(err) {toast(err.message,'err');}
  });
}
