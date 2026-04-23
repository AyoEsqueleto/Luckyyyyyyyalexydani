import re

html_files = [
    "luckyauto-basic.html",
    "luckyauto-pro.html",
    "luckyauto-lucky.html",
    "comparador-planes-auto.html"
]

footer_html = """<footer class="site-footer">

<div class="footer-inner">
<div class="footer-col footer-brand">
<img loading="lazy" id="footerLogo" src="logoluckyblancosinfondo.png" alt="Logo Lucky Base">
<p>Soluciones digitales modernas para empresas que quieren crecer online.</p>
<div style="display:flex;gap:10px;margin-top:16px;justify-content:flex-start;" class="footer-socials-wrapper">
<a class="footer-social-link" href="https://www.instagram.com/luckybaseofficial/" target="_blank" rel="noopener noreferrer" aria-label="Instagram Lucky Base">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2.5" y="2.5" width="19" height="19" rx="5"/><circle cx="12" cy="12" r="4.5"/><circle cx="18" cy="6" r="1.2" fill="currentColor" stroke="none"/></svg>
</a>
<a class="footer-social-link" href="https://www.tiktok.com/@luckybaseofficial" target="_blank" rel="noopener noreferrer" aria-label="TikTok Lucky Base">
<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14.5 3c.4 1.8 1.8 3.2 3.5 3.7v2.6c-1.4 0-2.7-.4-3.8-1.2v6.5c0 3.3-2.7 5.9-6 5.9s-6-2.6-6-5.9 2.7-5.9 6-5.9c.3 0 .7 0 1 .1v2.8c-.3-.1-.6-.2-1-.2-1.7 0-3.1 1.4-3.1 3.1s1.4 3.1 3.1 3.1 3.1-1.4 3.1-3.1V3h3.2z"/></svg>
</a>
<a class="footer-social-link" href="https://discord.com/invite/GYJN7kEwU2" target="_blank" rel="noopener noreferrer" aria-label="Discord Lucky Base">
<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20 4.5a17.4 17.4 0 0 0-4.1-1.3 12.2 12.2 0 0 0-.5 1.1 16.8 16.8 0 0 0-6.8 0 12 12 0 0 0-.5-1.1A17.3 17.3 0 0 0 4 4.5C1.5 8 1 11.4 1.2 14.8c1.7 1.3 3.4 2.1 5.2 2.6.4-.6.8-1.2 1.1-1.9-.6-.2-1.2-.5-1.7-.8.1-.1.3-.2.4-.3 3.3 1.5 6.9 1.5 10.2 0 .1.1.3.2.4.3-.6.3-1.1.6-1.7.8.3.7.7 1.3 1.1 1.9 1.8-.5 3.5-1.3 5.2-2.6.3-3.9-.7-7.3-3.2-10.3zM8.5 13.1c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm7 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z"/></svg>
</a>
</div>
</div>
<div class="footer-col">
<h4>Servicios</h4>
<ul>
<li><a href="luckyweb.html">LuckyWeb</a></li>
<li><a href="planes.html">Planes</a></li>
<li><a href="comparador-planes-web.html">Comparador de planes</a></li>
<li><a href="index.html#servicios">Automatizaciones</a></li>
</ul>
</div>
<div class="footer-col">
<h4>LuckyBase</h4>
<ul>
<li><a href="index.html#about">Nosotros</a></li>
<li><a href="index.html#faq">FAQ</a></li>
<li><a href="index.html#contacto">Contacto</a></li>
<li><a href="panel.html">Panel Cliente</a></li>
</ul>
</div>
<div class="footer-col">
<h4>Legal</h4>
<ul>
<li><a href="privacy-policy.html">Privacidad</a></li>
<li><a href="terminos-condiciones.html">Términos</a></li>
<li><a href="cookie-policy.html">Cookies</a></li>
<li><a href="#" class="footer-preferences">Mis preferencias</a></li>
</ul>
</div>
</div>
<div class="footer-bottom">
<span style="display:block;margin:0;padding-bottom:0;">&copy; 2026 LuckyBase. Todos los derechos reservados.</span>
</div>
</footer>"""

footer_css = """
/* ── FOOTER ── */
.site-footer{
background:linear-gradient(135deg,#0f3aa8,#1565ff 55%,#1f6bff);
color:white;margin-top:80px;position:relative;
box-shadow:0 -12px 40px rgba(15,23,42,0.22);
}
.footer-inner{
display:grid;grid-template-columns:2fr 1fr 1fr 1fr;
gap:40px;max-width:1200px;margin:0 auto;padding:52px 8% 40px;
}
.footer-brand img{height:40px;width:auto;display:block;margin-bottom:14px;}
.footer-brand p{font-size:13px;color:rgba(255,255,255,0.75);line-height:1.6;max-width:280px;}
.footer-col h4{font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.5);margin-bottom:14px;}
.footer-col ul{list-style:none;padding:0;display:flex;flex-direction:column;gap:8px;}
.footer-col ul li a{font-size:14px;color:rgba(255,255,255,0.85);text-decoration:none;transition:0.2s;}
.footer-col ul li a:hover{color:#fff;}
.footer-social-link{
display:inline-flex;align-items:center;justify-content:center;
width:36px;height:36px;border-radius:50%;
background:rgba(255,255,255,0.15);color:#fff;text-decoration:none;transition:0.3s;
}
.footer-social-link:hover{background:rgba(255,255,255,0.28);transform:scale(1.08);}
.footer-social-link svg{width:18px;height:18px;display:block;}
.footer-bottom{text-align:center;padding:16px 8%;border-top:1px solid rgba(255,255,255,0.12);font-size:13px;color:rgba(255,255,255,0.55);}
@media(max-width:900px){.footer-inner{grid-template-columns:1fr 1fr;gap:28px;}}
@media(max-width:560px){.footer-inner{grid-template-columns:1fr;gap:22px;padding:36px 5% 28px;}}

.footer-copy{
display:flex;
align-items:center;
justify-content:center;
gap:10px;
}
.footer-copy img{
width:30px;
height:30px;
object-fit:contain;
display:block;
}
.footer-socials{
display:flex;
justify-content:center;
gap:10px;
margin-top:12px;
}
.footer-instagram{
display:inline-flex;
align-items:center;
justify-content:center;
width:34px;
height:34px;
border-radius:50%;
background:#fff;
color:#1565ff;
text-decoration:none;
transition:transform 0.2s ease, background 0.2s ease;
}
.footer-instagram:hover{
transform:scale(1.08);
background:#dbeafe;
}
.footer-instagram svg{
width:18px;
height:18px;
display:block;
}
.footer-preferences{
display:inline-block;
padding:6px 10px;
border-radius:8px;
background:#fff;
color:#1565ff;
text-decoration:none;
font-size:12px;
font-weight:600;
transition:background 0.2s ease;
position:absolute;
right:35px;
bottom:35px;
}
.footer-preferences:hover{
background:#f3f6ff;
}
@media(max-width:600px){
  .footer-preferences{
    position:static;
    margin-top:12px;
  }
}
.footer-legal{
margin-top:10px;
}
.footer-legal a{
color:#dbeafe;
font-size:13px;
text-decoration:none;
}
.footer-legal a:hover{
text-decoration:underline;
}
"""

for fpath in html_files:
    with open(fpath, "r", encoding="utf-8") as f:
        content = f.read()

    # 1. Remove my previously injected <footer> and <style> entirely up to </body>
    start_idx = content.rfind("<footer>")
    end_idx = content.rfind("</style>")
    if start_idx != -1 and end_idx != -1 and start_idx < end_idx:
        # Extraer lo que viene despues de </style>
        tail = content[end_idx+8:]
        content = content[:start_idx] + tail

    # 2. Add proper footer HTML right before </body>
    if "</body>" in content:
        content = content.replace("</body>", footer_html + "\\n</body>")
    else:
        content += "\\n" + footer_html
    
    # 3. Add proper CSS to <head>
    if "<style>" in content and "</style>" in content:
        # insert at end of first style block
        content = content.replace("</style>", footer_css + "\\n</style>", 1)
    else:
        content = content.replace("</head>", f"<style>{footer_css}</style>\\n</head>")
        
    with open(fpath, "w", encoding="utf-8") as f:
        f.write(content)
        
print("Updated all footers to match the global structure.")
