import re

def update_file(filename, price_val, maint_val):
    with open(filename, "r", encoding="utf-8") as f:
        c = f.read()
    
    c = re.sub(r'<li>Precio:.*?</li>', f'<li>Precio: {price_val}</li>', c)
    c = re.sub(r'<li>Mantenimiento:.*?</li>', f'<li>Mantenimiento: {maint_val}</li>', c)
    
    # Añadir enlace secundario a terminos
    btn_link = '<a class="secondary" href="terminos-contratacion-auto.html">Ver documentación completa</a>'
    if "terminos-contratacion-auto" not in c:
        c = c.replace(
            '<a class="secondary" href="planes.html">Volver a planes</a>',
            '<a class="secondary" href="planes.html">Volver a planes</a>\n' + btn_link
        )
        
    with open(filename, "w", encoding="utf-8") as f:
        f.write(c)

update_file("luckyauto-basic.html", "120€", "15€/mes")
update_file("luckyauto-pro.html", "350€", "30€/mes")
update_file("luckyauto-lucky.html", "650€", "60€/mes")
print("Done")
