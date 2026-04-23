with open("terminos-contratacion-web.html", "r", encoding="utf-8") as f:
    html = f.read()

html = html.replace("Términos Contratación Web", "Términos Contratación Auto")
html = html.replace("Términos de Contratación Web", "Términos de Contratación Auto")
html = html.replace("contratación de páginas web de LuckyBase", "contratación de automatizaciones de LuckyBase")
html = html.replace("terminos-contratacion-web.html", "terminos-contratacion-auto.html")

new_docs = """<section class="docs">
<article class="card">
<h3>TyC LuckyAuto Básico</h3>
<p>Términos y condiciones aplicables a la contratación del plan LuckyAuto Básico.</p>
<a class="download" href="TyC-Auto-Basica.pdf" target="_blank" rel="noopener noreferrer">Abrir PDF</a>
</article>

<article class="card">
<h3>TyC LuckyAuto Pro</h3>
<p>Términos y condiciones aplicables a la contratación del plan LuckyAuto Pro.</p>
<a class="download" href="TyC-Auto-Pro.pdf" target="_blank" rel="noopener noreferrer">Abrir PDF</a>
</article>

<article class="card">
<h3>TyC LuckyAuto Lucky</h3>
<p>Términos y condiciones aplicables a la contratación del plan LuckyAuto Lucky.</p>
<a class="download" href="TyC-Auto-Lucky.pdf" target="_blank" rel="noopener noreferrer">Abrir PDF</a>
</article>

<article class="card">
<h3>Contrato de Servicios</h3>
<p>Documento contractual sobre la prestación de servicios de automatización y tratamiento de datos.</p>
<a class="download" href="Contrato de Servicios de Automatización y Tratamiento de Datos.pdf" target="_blank" rel="noopener noreferrer">Abrir PDF</a>
</article>
</section>"""

import re
html = re.sub(r'<section class="docs">.*?</section>', new_docs, html, flags=re.DOTALL)

with open("terminos-contratacion-auto.html", "w", encoding="utf-8") as f:
    f.write(html)
print("done")
