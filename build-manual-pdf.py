"""Generate the downloadable manual from the same HTML used in the editor.
Run before npm run build. Requires reportlab, beautifulsoup4 and svglib.
"""
from pathlib import Path
from html import escape
from bs4 import BeautifulSoup, NavigableString
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.platypus import BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, PageBreak, Image, LongTable, TableStyle, KeepTogether
from reportlab.platypus.tableofcontents import TableOfContents
from svglib.svglib import svg2rlg

ROOT=Path(__file__).resolve().parent
PAGE_W,PAGE_H=A4
MARGIN=45
WIDTH=PAGE_W-2*MARGIN
for name,file in [('Manual','DejaVuSans.ttf'),('Manual-Bold','DejaVuSans-Bold.ttf'),('Manual-Oblique','DejaVuSans-Oblique.ttf')]:
    font_path=Path('/usr/share/fonts/truetype/dejavu')/file
    if not font_path.exists():
        import matplotlib
        font_path=Path(matplotlib.__file__).parent/'mpl-data/fonts/ttf'/file
    pdfmetrics.registerFont(TTFont(name, str(font_path)))
pdfmetrics.registerFontFamily('Manual',normal='Manual',bold='Manual-Bold',italic='Manual-Oblique',boldItalic='Manual-Bold')
INK=colors.HexColor('#263f48');MINT=colors.HexColor('#175f51');MUTED=colors.HexColor('#56727c')
styles={
 'body':ParagraphStyle('body',fontName='Manual',fontSize=9.1,leading=14.2,textColor=INK,spaceAfter=8),
 'heading':ParagraphStyle('heading',fontName='Manual-Bold',fontSize=16.5,leading=22,textColor=MINT,spaceBefore=16,spaceAfter=12,keepWithNext=True),
 'sub':ParagraphStyle('sub',fontName='Manual-Bold',fontSize=11,leading=16,textColor=INK,spaceBefore=12,spaceAfter=7,keepWithNext=True),
 'caption':ParagraphStyle('caption',fontName='Manual-Oblique',fontSize=8,leading=12,textColor=MUTED,spaceAfter=13),
 'cell':ParagraphStyle('cell',fontName='Manual',fontSize=8,leading=12,textColor=INK,spaceAfter=0),
 'header':ParagraphStyle('header',fontName='Manual-Bold',fontSize=8,leading=12,textColor=MINT),
 'tip':ParagraphStyle('tip',fontName='Manual',fontSize=8.5,leading=13,textColor=MINT,backColor=colors.HexColor('#edf6f0'),borderColor=colors.HexColor('#b9d8c7'),borderWidth=.5,borderPadding=9,spaceBefore=6,spaceAfter=13),
 'cover':ParagraphStyle('cover',fontName='Manual-Bold',fontSize=35,leading=43,textColor=colors.HexColor('#124755'),spaceAfter=15),
 'kicker':ParagraphStyle('kicker',fontName='Manual-Bold',fontSize=10,leading=17,textColor=MUTED,spaceAfter=13),
 'lead':ParagraphStyle('lead',fontName='Manual',fontSize=12,leading=20,textColor=INK,spaceAfter=18),
 'toc':ParagraphStyle('toc',fontName='Manual',fontSize=9,leading=13,textColor=INK,leftIndent=8,rightIndent=15,spaceBefore=0,spaceAfter=0),
}
def plain(s):
    return s.replace('\u2011','-').replace('\u2013','-').replace('\u2014','-').replace('\u2212','-')
def rich(node):
    if isinstance(node,NavigableString):return escape(plain(str(node)))
    text=''.join(rich(child) for child in node.children)
    if node.name in ('b','strong'):return '<b>'+text+'</b>'
    if node.name=='br':return '<br/>'
    if node.name in ('em','i'):return '<i>'+text+'</i>'
    return text
def paragraph(node,style='body'):
    return Paragraph(rich(node),styles[style])
def decorate(c,doc):
    c.saveState()
    if doc.page>1:
        c.setStrokeColor(colors.HexColor('#c7d9dd'));c.line(MARGIN,PAGE_H-33,PAGE_W-MARGIN,PAGE_H-33)
        c.setFont('Manual',8);c.setFillColor(MUTED);c.drawString(MARGIN,PAGE_H-25,'VIVA AUDIO STUDIO SUITE EDITOR | Manual 1.20.0')
    c.setFont('Manual',8);c.setFillColor(MUTED);c.drawString(MARGIN,24,'Edición, grabación y mezcla de audio');c.drawRightString(PAGE_W-MARGIN,24,str(doc.page))
    c.restoreState()
class ManualDoc(BaseDocTemplate):
    def afterFlowable(self,flowable):
        if getattr(flowable,'manual_id',None):
            text=flowable.getPlainText();key=flowable.manual_id
            self.canv.bookmarkPage(key);self.canv.addOutlineEntry(text,key,0,False)
            self.notify('TOCEntry',(0,text,self.page,key))
soup=BeautifulSoup((ROOT/'manual.content.html').read_text(),'html.parser')
doc=ManualDoc(str(ROOT/'viva-studio-manual.pdf'),pagesize=A4,rightMargin=MARGIN,leftMargin=MARGIN,topMargin=51,bottomMargin=43,title='Manual de VIVA AUDIO STUDIO SUITE EDITOR',author='VIVA AUDIO STUDIO SUITE EDITOR')
doc.addPageTemplates(PageTemplate(id='manual',frames=[Frame(MARGIN,43,WIDTH,PAGE_H-94,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)],onPage=decorate))
story=[Spacer(1,60),Image(str(ROOT/'logo-viva.jpg'),width=84,height=84,hAlign='LEFT'),Spacer(1,30),Paragraph('VIVA AUDIO STUDIO SUITE EDITOR · VERSIÓN 1.20.0',styles['kicker']),Paragraph('Manual de<br/>VIVA AUDIO<br/>STUDIO SUITE EDITOR',styles['cover']),Paragraph('De la primera toma a una mezcla terminada.',styles['lead']),Paragraph('Una guía de edición, grabación, automatización, mezcla y exportación. Incluye el recorrido inicial, los efectos de pista y una referencia de atajos.',styles['body']),Spacer(1,25),Paragraph('Proyectos nuevos con cuatro pistas · EQ en el mezclador · FX morado cuando hay efectos aplicados',styles['tip']),Spacer(1,25),paragraph(soup.select_one('.manual-lead')),PageBreak(),Paragraph('Índice',styles['heading'])]
toc=TableOfContents();toc.levelStyles=[styles['toc']];story.extend([toc,PageBreak()])
for article in soup.select('[data-manual-chapter]'):
    if article['id']=='manual-reference':story.append(PageBreak())
    h=paragraph(article.h2,'heading');h.manual_id=article['id'];story.append(h)
    for node in article.children:
        if isinstance(node,NavigableString) or node.name=='h2':continue
        if node.name=='p':story.append(paragraph(node,'tip' if 'manual-tip' in node.get('class',[]) else 'body'))
        elif node.name=='h3':story.append(paragraph(node,'sub'))
        elif node.name in ('ol','ul'):
            for i,li in enumerate(node.find_all('li',recursive=False),1):
                prefix=str(i)+'. ' if node.name=='ol' else '• '
                story.append(Paragraph(prefix+rich(li),styles['body']))
        elif node.name=='table':
            data=[]
            for row in node.find_all('tr'):
                data.append([paragraph(cell,'header' if cell.name=='th' else 'cell') for cell in row.find_all(['td','th'],recursive=False)])
            count=len(data[0]);widths=[WIDTH*.31]+[WIDTH*.69/(count-1)]*(count-1)
            t=LongTable(data,colWidths=widths,repeatRows=1,hAlign='LEFT',spaceBefore=6,spaceAfter=12)
            t.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e0f0e9')),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#f1f6f6')]),('GRID',(0,0),(-1,-1),.4,colors.HexColor('#b4c8ce')),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]));story.append(t)
        elif node.name=='figure':
            source=ROOT/node.img['src']
            if source.suffix=='.svg':
                img=svg2rlg(str(source));factor=WIDTH/img.width;img.width*=factor;img.height*=factor;img.scale(factor,factor)
            else:
                from PIL import Image as PILImage
                w,h=PILImage.open(source).size
                target=min(WIDTH,180 if 'manual-narrow-figure' in node.get('class',[]) else WIDTH)
                img=Image(str(source),width=target,height=h*target/w,hAlign='LEFT')
            caption=paragraph(node.figcaption,'caption')
            story.extend([Spacer(1,7),KeepTogether([img,Spacer(1,5),caption])])
    story.append(Spacer(1,6))
doc.multiBuild(story)
print(ROOT/'viva-studio-manual.pdf')
