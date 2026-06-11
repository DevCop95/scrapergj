# GDL Food Guide

Guía interactiva de los mejores negocios de comida en Guadalajara, Jalisco.

## 🌐 Demo en Vivo

**https://devcop95.github.io/scrapergj/**

## Categorías

- **Tacos y Varios** (100 negocios)
- **Tortas Ahogadas** (100 negocios)
- **Menuderías** (100 negocios)

## Características

- ✅ **300 negocios verificados** con datos completos de Google Maps
- ✅ **Garantía sin duplicados**: Deduplicación global cruzada por nombre y teléfono en todas las categorías
- ✅ **Filtrado estricto por reputación**: Cada negocio tiene **más de 800 opiniones** en Google Maps
- ✅ **Sistema Top 10**: Ranking por número de reseñas (👑 badge especial en el mapa y en la tarjeta)
- ✅ **300/300 negocios** con cantidad de opiniones verificada (100% de cobertura)
- ✅ Fotos reales, teléfonos, horarios completos, nivel de precios
- ✅ Búsqueda inteligente (fuzzy search) con Fuse.js
- ✅ Diseño moderno responsivo y modo oscuro/claro automático
- ✅ Exportación a Excel organizada con pestañas por categoría, mapa embebido y resumen general

## Uso

### Web

Abre `index.html` en tu navegador o levanta un servidor estático:
```bash
npx http-server -p 8080
```
Y accede a `http://127.0.0.1:8080/index.html`.

### Excel

Haz clic en **"Exportar Excel"** para descargar la base de datos completa organizada en pestañas por categoría.

## Datos

Los datos están almacenados en 3 archivos CSV enriquecidos y deduplicados:

- `enriched_-Negocio-Direccin--PrecioMXN-Especialidad-GoogleMa.csv` - Tacos y Varios
- `enriched_-Negocio-Direccin--PrecioMXN-Observaciones-GoogleM.csv` - Tortas Ahogadas
- `enriched_-Negocio-Direccin--PrecioMXN-Perfildecliente-Googl.csv` - Menuderías y Birrias

## Tecnologías

- HTML5 + Tailwind CSS (Responsivo + Glassmorphism)
- JavaScript Vanilla
- PapaParse (lectura de archivos CSV)
- SheetJS (exportación a Excel limpia y con estilos de columna)
- Fuse.js (búsqueda con tolerancia a errores ortográficos)
- Playwright (raspador automatizado)

## Top 3 Clientes (por Reseñas)

### Tacos
1. Tepatiani: **23,559** reviews ⭐4.3
2. La Chata de Guadalajara: **23,193** reviews ⭐4.6
3. Taco Fish Paz: **20,386** reviews ⭐4.7

### Tortas Ahogadas
1. El Parián de Tlaquepaque: **50,868** reviews ⭐4.4
2. El Abajeño Tlaquepaque: **10,064** reviews ⭐4.3
3. Tortas Ahogadas Don Jose El De La Bicicleta: **6,561** reviews ⭐4.3

### Menuderías y Birrias
1. Menudería San Juan: **92,065** reviews ⭐4.4
2. Tianguis Tonalá: **35,481** reviews ⭐4.6
3. Birrierías Chololo: **20,272** reviews ⭐4.6

## Scripts de Mantenimiento

```bash
# Reparar datos faltantes (browser pooling)
node scraper.js

# Scrape review counts (stealth mode)
node scrape_all_reviews.js

# Enriquecer top 10 con datos extra
node enrich_top10.js

# Buscar Maps URLs faltantes
node fix_missing.js

# Buscar fotos faltantes
node fix_photos.js
```

---

**Creado por Devcop95** - 2026
