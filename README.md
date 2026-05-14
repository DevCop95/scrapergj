# GDL Food Guide

Guía interactiva de los mejores negocios de comida en Guadalajara, Jalisco.

## 🌐 Demo en Vivo

**https://devcop95.github.io/scrapergj/**

## Categorías

- **Tacos y Varios** (30 negocios)
- **Tortas Ahogadas** (30 negocios)
- **Menuderías** (30 negocios)

## Características

- ✅ **90 negocios verificados** con datos completos de Google Maps
- ✅ **Sistema Top 10**: Ranking por número de reseñas (👑 badge especial)
- ✅ **90/90 negocios** con review count (100% cobertura)
- ✅ Fotos reales, teléfonos, horarios, precios
- ✅ Búsqueda fuzzy con tolerancia a errores
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

## Top 10 Clientes (por Reviews)

### Tacos
1. Taco Fish Paz: **20,000** reviews ⭐4.7
2. Tomate Taquería: **17,500** reviews ⭐4.7
3. Tacos Los Generales: **11,189** reviews ⭐4.5

### Tortas Ahogadas
1. Tortas La Chata: **23,066** reviews ⭐4.4
2. José de Bicicleta: **6,537** reviews ⭐4.8
3. Ahogadas de Sánchez: **6,536** reviews ⭐4.6

### Menudo/Birria
1. Birria y carne asada Don José: **6,748** reviews ⭐4.7
2. Super Menudería Cano: **4,735** reviews ⭐4.6
3. Menudería La Güera: **4,127** reviews ⭐4.4

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
