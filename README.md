# GDL Food Guide

Guía interactiva de los mejores negocios de comida en Guadalajara, Jalisco.

## Categorías

- **Tacos y Varios** (30 negocios)
- **Tortas Ahogadas** (30 negocios)
- **Menuderías** (30 negocios)

## Características

- ✅ 90 negocios verificados en Guadalajara
- ✅ Fotos reales de cada negocio
- ✅ Enlaces directos a Google Maps
- ✅ Calificaciones, precios y horarios
- ✅ Búsqueda por nombre, dirección o especialidad
- ✅ Modo oscuro/claro
- ✅ Exportación a Excel

## Uso

### Web

Abre `index.html` en tu navegador.

### Excel

Click en "Exportar Excel" para descargar todos los negocios organizados por categoría.

## Datos

Los datos están en 3 archivos CSV enriquecidos:

- `enriched_-Negocio-Direccin--PrecioMXN-Especialidad-GoogleMa.csv` - Tacos
- `enriched_-Negocio-Direccin--PrecioMXN-Observaciones-GoogleM.csv` - Tortas
- `enriched_-Negocio-Direccin--PrecioMXN-Perfildecliente-Googl.csv` - Menuderías

## Tecnologías

- HTML5 + Tailwind CSS
- JavaScript vanilla
- PapaParse (lectura CSV)
- SheetJS (exportación Excel)
- Playwright (scraping de datos)

## Mantenimiento

### Actualizar datos

```bash
node scraper.js
```

Verifica y actualiza información de Google Maps para todos los negocios.

---

**Creado por Devcop95** - 2026
