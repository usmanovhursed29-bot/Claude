"""Build the installable (PWA) version of Kwantoww from ../index.html.
Run: python3 projects/365-app/pwa/build.py  -> writes projects/365-app/pwa/dist/"""
import os, re, json, hashlib
from PIL import Image, ImageDraw, ImageFont
here=os.path.dirname(os.path.abspath(__file__)); dist=os.path.join(here,"dist"); os.makedirs(dist,exist_ok=True)
src=open(os.path.join(here,"..","index.html"),encoding="utf-8").read()
src=src.replace("const STANDALONE=false;","const STANDALONE=true;",1)

title=re.search(r"<title>(.*?)</title>",src).group(1)
body=re.sub(r"<title>.*?</title>\n?","",src,count=1)
body=body.replace('<meta name="claude:viewport-fit-sides" content="cover">\n','')
ver=hashlib.sha1((body+open(os.path.join(here,"tg.js"),encoding="utf-8").read()).encode()).hexdigest()[:8]
body=body.replace('const BUILD="dev";',f'const BUILD="{ver}";',1)
body=body.replace('const AI_URL="";',f'const AI_URL="{os.environ.get("KWANTOWW_AI_URL","https://kwantoww-ai.usmanovhursed747.workers.dev")}";',1)
head=f'''<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="Личный пульт: задачи, календарь, привычки, здоровье, питание, финансы и заметки">
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#f6f5f2" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#141413" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Kwantoww">
<link rel="apple-touch-icon" href="icon-180.png">
<link rel="icon" href="icon-192.png" type="image/png">
<script src="https://telegram.org/js/telegram-web-app.js?59" async onload="window.__tgReady&&window.__tgReady()"></script>
<style>:root{{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}}body{{margin:0}}img{{max-width:100%}}[hidden]{{display:none!important}}</style>
</head>
<body>
'''
TG=open(os.path.join(here,"tg.js"),encoding="utf-8").read()
tail=f'''
<script>
{TG}if("serviceWorker" in navigator)addEventListener("load",()=>navigator.serviceWorker.register("sw.js",{{updateViaCache:"none"}}).then(r=>r.update()).catch(()=>{{}}));</script>
</body>
</html>
'''
open(os.path.join(dist,"index.html"),"w",encoding="utf-8").write(head+body+tail)
manifest={"name":"Kwantoww","short_name":"Kwantoww","description":"Личный пульт: задачи, привычки, здоровье, питание, финансы","lang":"ru","start_url":"./","scope":"./","display":"standalone","orientation":"any","background_color":"#f6f5f2","theme_color":"#f6f5f2",
 "icons":[{"src":"icon-192.png","sizes":"192x192","type":"image/png"},{"src":"icon-512.png","sizes":"512x512","type":"image/png"},{"src":"icon-maskable-512.png","sizes":"512x512","type":"image/png","purpose":"maskable"}]}
json.dump(manifest,open(os.path.join(dist,"manifest.webmanifest"),"w",encoding="utf-8"),ensure_ascii=False,indent=1)
sw=open(os.path.join(here,"sw.template.js"),encoding="utf-8").read().replace("__VER__",ver)
open(os.path.join(dist,"sw.js"),"w").write(sw)
def icon(size,maskable=False):
    im=Image.new("RGBA",(size,size),(0,0,0,0));d=ImageDraw.Draw(im)
    pad=0 if maskable else int(size*0.06);r=0 if maskable else int(size*0.22)
    d.rounded_rectangle([pad,pad,size-pad,size-pad],radius=r,fill=(29,27,23,255))
    fp=None
    for f in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf","/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"]:
        if os.path.exists(f):fp=f;break
    font=ImageFont.truetype(fp,int(size*(0.30 if maskable else 0.36))) if fp else ImageFont.load_default()
    t="kw";bb=d.textbbox((0,0),t,font=font);w,h=bb[2]-bb[0],bb[3]-bb[1]
    d.text(((size-w)/2-bb[0],(size-h)/2-bb[1]-size*0.02),t,font=font,fill=(246,245,242,255))
    d.rounded_rectangle([size*0.40,size*0.70,size*0.60,size*0.73],radius=size*0.015,fill=(108,140,240,255))
    return im
icon(192).save(os.path.join(dist,"icon-192.png"));icon(512).save(os.path.join(dist,"icon-512.png"))
icon(180,True).convert("RGB").save(os.path.join(dist,"icon-180.png"));icon(512,True).save(os.path.join(dist,"icon-maskable-512.png"))
print("built",dist,ver)
