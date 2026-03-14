/**
 * Seed: Community Reports
 *
 * Genera 150 reportes realistas distribuidos en los últimos 30 días,
 * con clasificación incluida. No necesita LLM ni servidor corriendo.
 *
 * Uso:
 *   pnpm seed:community
 *   pnpm seed:community -- --clear   (borra datos previos antes de seedear)
 *
 * Los reportes están escritos en español argentino informal,
 * con errores de tipeo intencionales, como los escribiría un vecino
 * real desde el celular a las 2am.
 */

import { getDb, closeDb } from "../community/db.js";
import { nanoid } from "nanoid";

// ── Config ─────────────────────────────────────────────────

const TENANT_ID = process.env.COMMUNITY_TENANT_ID?.trim() || "tenant-default";
const TOTAL_REPORTS = 150;
const DAYS_BACK = 30;
const CLEAR_FLAG = process.argv.includes("--clear");

// ── Ubicaciones reales (repetidas a propósito para hotspots) ──

// Ubicaciones reales de Cariló — distribuidas por toda la localidad
// Calles: árboles (E-O), pájaros (N-S). Avenidas: Divisadero, Constancia, Costanera
// Coordenadas: lat ~-37.155 a -37.175, lng ~-56.89 a -56.92
const LOCATIONS: Array<{ address: string; lat: number; lng: number; weight: number }> = [
  // ── Zona norte (cerca de Valeria del Mar) ──
  { address: "Jacarandá y Carpintero",           lat: -37.1555, lng: -56.9005, weight: 4 },
  { address: "Av. Constancia y Cerezo",          lat: -37.1565, lng: -56.9030, weight: 6 },
  { address: "Lambertiana y Benteveo",           lat: -37.1570, lng: -56.8960, weight: 3 },
  // ── Zona centro-norte ──
  { address: "Av. Divisadero y Carpintero",      lat: -37.1595, lng: -56.9045, weight: 8 },
  { address: "Cerezo y Boyero",                  lat: -37.1605, lng: -56.9025, weight: 7 },
  { address: "Centro Comercial Cariló",          lat: -37.1600, lng: -56.8985, weight: 12 },
  { address: "Araucaria y Jilguero",             lat: -37.1588, lng: -56.9070, weight: 4 },
  // ── Zona centro (corazón del barrio) ──
  { address: "Av. Divisadero y Calandria",       lat: -37.1625, lng: -56.9050, weight: 10 },
  { address: "Cedro y Zorzal",                   lat: -37.1630, lng: -56.9015, weight: 5 },
  { address: "Nogal y Hornero",                  lat: -37.1635, lng: -56.8975, weight: 4 },
  { address: "Pino y Cardenal",                  lat: -37.1620, lng: -56.9090, weight: 3 },
  // ── Zona centro-sur ──
  { address: "Av. Divisadero y Avellano",        lat: -37.1655, lng: -56.9055, weight: 6 },
  { address: "Fresno y Martineta",               lat: -37.1660, lng: -56.8990, weight: 4 },
  { address: "Lapacho y Golondrina",             lat: -37.1650, lng: -56.9020, weight: 5 },
  // ── Zona sur (dunas y bosque) ──
  { address: "Molle y Ñandú",                    lat: -37.1685, lng: -56.9040, weight: 3 },
  { address: "Av. Costanera sur",                lat: -37.1700, lng: -56.8950, weight: 3 },
  { address: "Magnolia y Perdiz",                lat: -37.1690, lng: -56.9075, weight: 2 },
  // ── Zona costera (este, cerca de la playa) ──
  { address: "Av. Costanera y Cerezo",           lat: -37.1590, lng: -56.8920, weight: 5 },
  { address: "Av. Costanera y Avellano",         lat: -37.1640, lng: -56.8935, weight: 4 },
  // ── Zona ruta (oeste, accesos) ──
  { address: "Acceso Cariló por Ruta 11",        lat: -37.1575, lng: -56.9130, weight: 5 },
  { address: "Rotonda Pinamar-Cariló",           lat: -37.1545, lng: -56.9100, weight: 3 },
];

// ── Reportes por categoría ─────────────────────────────────
// Cada uno tiene variantes de texto realista + subcategoría + urgency range

interface ReportTemplate {
  category: string;
  subcategory: string;
  texts: string[];
  urgency_min: number;
  urgency_max: number;
  route_to: string;
  confidence_min: number;
  confidence_max: number;
  time_bias: "night" | "day" | "any"; // cuándo es más probable
  frequency_weight: number; // peso relativo de aparición
}

const TEMPLATES: ReportTemplate[] = [
  // ── Seguridad (35% de reportes) ──
  {
    category: "seguridad", subcategory: "persona_sospechosa",
    texts: [
      "Hay un tipo caminando por la calle mirando las casas, lleva una mochila negra y esta hace como 20 min dando vueltas",
      "persona sospechosa en bici recorriendo la cuadra, paso ya 3 veces mirnado las entradas de las casas",
      "un auto gris parado en la esquina con las luces apagadas, hay dos personas adentro hace rato",
      "Alguien camina por los fondos de los lotes, se escuchan pasos y el perro no para de ladrar",
      "hay un flaco en la obra de enfrente a las 11 de la noche, no es horario de obra",
      "vi un tipo saltando una medianera en la calle Cerezo, fue hace 5 min",
      "auto blanco sin patente estacionado hace 3 dias en la misma esquina, nadie lo conoce",
      "moto ruidosa da vueltas por el barrio a baja velocidad, 2 personas arriba sin casco",
    ],
    urgency_min: 3, urgency_max: 5, route_to: "empresa_seguridad",
    confidence_min: 0.75, confidence_max: 0.95,
    time_bias: "night", frequency_weight: 15,
  },
  {
    category: "seguridad", subcategory: "robo",
    texts: [
      "nos entraron a robar, rompieron la ventana del fondo. ya llame a la policia",
      "se robaron la bicicleta del garage, estaba cerrado con candado y lo reventaron",
      "apareció la puerta forzada cuando llegamos, falta la tele y cosas de la cocina",
      "robaron herramientas del obrador de la obra de Boyero, fue anoche",
    ],
    urgency_min: 4, urgency_max: 5, route_to: "empresa_seguridad",
    confidence_min: 0.90, confidence_max: 0.98,
    time_bias: "night", frequency_weight: 5,
  },
  {
    category: "seguridad", subcategory: "vandalismo",
    texts: [
      "pintaron las paredes del centro comercial con graffitis, esta todo rayado",
      "rompieron el cartel de entrada al barrio otra vez",
      "encontre basura tirada y el tacho de la esquina dado vuelta, parece que fue a proposito",
      "las luminarias de la plaza las rompieron a piedrazos",
    ],
    urgency_min: 2, urgency_max: 3, route_to: "empresa_seguridad",
    confidence_min: 0.80, confidence_max: 0.92,
    time_bias: "night", frequency_weight: 6,
  },
  {
    category: "seguridad", subcategory: "vehiculo_sospechoso",
    texts: [
      "camioneta negra con vidrios polarizados estacionada frente a mi casa, motor encendido, nadie baja",
      "un auto con patente de capital hace pasadas lentas por la cuadra",
      "moto sin patente circulando despacito por zona de lotes vacios",
    ],
    urgency_min: 3, urgency_max: 4, route_to: "empresa_seguridad",
    confidence_min: 0.70, confidence_max: 0.88,
    time_bias: "night", frequency_weight: 9,
  },

  // ── Bomberos (10% de reportes) ──
  {
    category: "bomberos", subcategory: "quema",
    texts: [
      "el vecino de al lado esta quemando basura en el fondo, hay mucho humo",
      "estan haciendo una fogata grande en un lote baldio, con este viento es peligroso",
      "quema de pastizal en la zona de dunas, se ve desde lejos el humo",
      "humo denso viniendo del bosque, no se ve fuego pero el olor es fuerte",
    ],
    urgency_min: 3, urgency_max: 5, route_to: "bomberos",
    confidence_min: 0.85, confidence_max: 0.97,
    time_bias: "day", frequency_weight: 5,
  },
  {
    category: "bomberos", subcategory: "incendio_forestal",
    texts: [
      "HAY FUEGO EN EL BOSQUE cerca de la ruta, se ven llamas, vengan ya por favor!!",
      "incendio de pasto seco en sector dunas, se esta extendiendo rapido con el viento",
    ],
    urgency_min: 5, urgency_max: 5, route_to: "bomberos",
    confidence_min: 0.95, confidence_max: 0.99,
    time_bias: "day", frequency_weight: 2,
  },
  {
    category: "bomberos", subcategory: "riesgo_incendio",
    texts: [
      "hay un cable de luz caido sobre pasto seco en la esquina de Boyero, eso va a prender fuego",
      "acumulacion de ramas secas enorme al lado de una casa, es un peligro con el calor que hace",
      "transformador haciendo chispas en el poste de Av. Divisadero y Calandria",
    ],
    urgency_min: 3, urgency_max: 4, route_to: "bomberos",
    confidence_min: 0.78, confidence_max: 0.90,
    time_bias: "day", frequency_weight: 3,
  },

  // ── Vialidad (15% de reportes) ──
  {
    category: "vialidad", subcategory: "bache",
    texts: [
      "hay un pozo enorme en Av. Divisadero cerca del centro comercial, ya me rompi una cubierta",
      "bache peligroso en Cerezo y Boyero, de noche no se ve y es un peligro",
      "la calle de ripio esta toda hecha pelota despues de la lluvia, no se puede circular",
      "crater en la entrada del barrio, cada vez esta peor",
    ],
    urgency_min: 2, urgency_max: 3, route_to: "vialidad",
    confidence_min: 0.88, confidence_max: 0.96,
    time_bias: "day", frequency_weight: 8,
  },
  {
    category: "vialidad", subcategory: "alumbrado",
    texts: [
      "las luces de la calle estan apagadas hace 3 dias, esta todo oscuro y es peligroso",
      "el farol de la esquina titila y se apaga, justo en la curva",
      "no hay luz publica en todo el tramo de Carpintero, imposible caminar de noche",
    ],
    urgency_min: 2, urgency_max: 3, route_to: "vialidad",
    confidence_min: 0.90, confidence_max: 0.95,
    time_bias: "night", frequency_weight: 6,
  },
  {
    category: "vialidad", subcategory: "arbol_caido",
    texts: [
      "se cayo un arbol grande sobre la calle, no se puede pasar",
      "rama enorme colgando sobre la vereda, en cualquier momento se cae",
      "despues de la tormenta hay arboles caidos por todos lados en la zona del bosque",
    ],
    urgency_min: 3, urgency_max: 4, route_to: "vialidad",
    confidence_min: 0.92, confidence_max: 0.97,
    time_bias: "any", frequency_weight: 4,
  },

  // ── Convivencia (20% de reportes) ──
  {
    category: "convivencia", subcategory: "ruido_molesto",
    texts: [
      "la casa de la esquina tiene musica a todo volumen, son las 3 de la mañana",
      "fiesta en el alquiler temporario de Boyero, no dejan dormir a nadie",
      "obra en construccion haciendo ruido a las 7am un sabado, no se puede mas",
      "generador electrico funcionando toda la noche, un ruido insoportable",
      "los vecinos de atras tienen juntada con parlantes hasta las 4am todos los fines de semana",
    ],
    urgency_min: 2, urgency_max: 3, route_to: "administracion_barrio",
    confidence_min: 0.85, confidence_max: 0.95,
    time_bias: "night", frequency_weight: 10,
  },
  {
    category: "convivencia", subcategory: "mascota_suelta",
    texts: [
      "hay un perro grande suelto por la calle sin collar, parece agresivo",
      "los perros del vecino se escapan siempre y revientan las bolsas de basura",
      "perro abandonado en la plaza, esta flaco y se ve que lleva dias ahi",
    ],
    urgency_min: 1, urgency_max: 2, route_to: "administracion_barrio",
    confidence_min: 0.82, confidence_max: 0.93,
    time_bias: "day", frequency_weight: 5,
  },
  {
    category: "convivencia", subcategory: "basura",
    texts: [
      "alguien tiro bolsas de basura en el lote baldio de Calandria, es un asco",
      "no pasaron a recoger la basura hace una semana, esta todo podrido",
      "contenedor desbordado en el centro comercial, hay basura por todos lados",
      "escombros tirados en la banquina de la ruta, es un peligro",
    ],
    urgency_min: 1, urgency_max: 2, route_to: "administracion_barrio",
    confidence_min: 0.88, confidence_max: 0.94,
    time_bias: "day", frequency_weight: 6,
  },

  // ── Fiscalización (10% de reportes) ──
  {
    category: "fiscalizacion", subcategory: "construccion_irregular",
    texts: [
      "el vecino esta construyendo un segundo piso sin permiso, trabajan de noche para que no los vean",
      "obra nueva que supera la altura permitida, estan tapando todo con lonas",
      "estan haciendo una pileta en un lote donde no se puede por las napas",
      "construyeron un quincho que invade la linea municipal",
    ],
    urgency_min: 2, urgency_max: 3, route_to: "fiscalizacion_municipal",
    confidence_min: 0.75, confidence_max: 0.90,
    time_bias: "day", frequency_weight: 5,
  },
  {
    category: "fiscalizacion", subcategory: "comercio_no_habilitado",
    texts: [
      "hay una casa que esta funcionando como local de ropa, no tiene habilitacion",
      "food truck estacionado en zona residencial vendiendo todos los dias",
      "alquiler temporario sin habilitacion en Zorzal, entran y salen autos todo el dia",
    ],
    urgency_min: 1, urgency_max: 2, route_to: "fiscalizacion_municipal",
    confidence_min: 0.70, confidence_max: 0.85,
    time_bias: "day", frequency_weight: 4,
  },

  // ── Municipal (10% de reportes) ──
  {
    category: "municipal", subcategory: "consulta_ordenanza",
    texts: [
      "alguien sabe que horario se puede hacer ruido de obra? necesito saber la ordenanza",
      "consulta: se puede estacionar en Av. Divisadero? vi que pusieron carteles nuevos",
      "que tramite hay que hacer para habilitar un emprendimiento gastronomico en casa?",
    ],
    urgency_min: 1, urgency_max: 1, route_to: "municipalidad",
    confidence_min: 0.80, confidence_max: 0.92,
    time_bias: "day", frequency_weight: 4,
  },
  {
    category: "municipal", subcategory: "reclamo_general",
    texts: [
      "el desague pluvial de la esquina esta tapado, se inunda cada vez que llueve",
      "la plaza esta abandonada, el pasto alto, juegos rotos, da pena",
      "se necesita poda urgente de los arboles sobre la vereda, no dejan pasar",
      "el medidor de agua de la cuadra perdio agua todo el fin de semana",
    ],
    urgency_min: 2, urgency_max: 3, route_to: "municipalidad",
    confidence_min: 0.82, confidence_max: 0.93,
    time_bias: "day", frequency_weight: 6,
  },
];

// ── Helpers ────────────────────────────────────────────────

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Weighted random pick from LOCATIONS */
function pickLocation(): (typeof LOCATIONS)[number] {
  const totalWeight = LOCATIONS.reduce((s, l) => s + l.weight, 0);
  let r = Math.random() * totalWeight;
  for (const loc of LOCATIONS) {
    r -= loc.weight;
    if (r <= 0) return loc;
  }
  return LOCATIONS[0];
}

/** Weighted random pick from TEMPLATES */
function pickTemplate(): ReportTemplate {
  const totalWeight = TEMPLATES.reduce((s, t) => s + t.frequency_weight, 0);
  let r = Math.random() * totalWeight;
  for (const tmpl of TEMPLATES) {
    r -= tmpl.frequency_weight;
    if (r <= 0) return tmpl;
  }
  return TEMPLATES[0];
}

/** Generate a realistic timestamp within the last N days, biased by time_bias */
function generateTimestamp(daysBack: number, bias: "night" | "day" | "any"): string {
  const now = Date.now();
  const msBack = daysBack * 24 * 60 * 60 * 1000;
  const base = new Date(now - Math.random() * msBack);

  // Apply hour bias
  let hour: number;
  if (bias === "night") {
    // 60% chance: 20-03h, 40% chance: any hour
    hour = Math.random() < 0.6 ? (rand(20, 27) % 24) : rand(0, 23);
  } else if (bias === "day") {
    // 70% chance: 8-19h, 30% chance: any hour
    hour = Math.random() < 0.7 ? rand(8, 19) : rand(0, 23);
  } else {
    hour = rand(0, 23);
  }

  base.setHours(hour, rand(0, 59), rand(0, 59));
  return base.toISOString();
}

/** Build a summary from the report text */
function buildSummary(text: string): string {
  // Limpiar y acortar
  const clean = text.replace(/[!]+/g, ".").replace(/\s+/g, " ").trim();
  if (clean.length <= 80) return clean;
  return clean.slice(0, 77) + "...";
}

// ── Resident IDs (simular vecinos reales recurrentes) ──

const RESIDENT_IDS = [
  "vecino-maria", "vecino-carlos", "vecino-ana", "vecino-jorge",
  "vecino-laura", "vecino-pablo", "vecino-silvia", "vecino-martin",
  "vecino-ceci", "vecino-rober", "vecino-marta", "vecino-diego",
  `anon-${Date.now()}`, `anon-${Date.now() + 1}`, `anon-${Date.now() + 2}`,
];

// ── Main ───────────────────────────────────────────────────

function seed(): void {
  console.log(`\n🌱 Seeding ${TOTAL_REPORTS} community reports for tenant "${TENANT_ID}"...`);
  console.log(`   Spanning last ${DAYS_BACK} days\n`);

  const db = getDb();

  if (CLEAR_FLAG) {
    console.log("   🗑️  Clearing existing data...");
    db.prepare("DELETE FROM notifications WHERE tenant_id = ?").run(TENANT_ID);
    db.prepare("DELETE FROM weekly_summaries WHERE tenant_id = ?").run(TENANT_ID);
    db.prepare("DELETE FROM classification_runs WHERE tenant_id = ?").run(TENANT_ID);
    // Photos FK cascade from reports
    db.prepare("DELETE FROM reports WHERE tenant_id = ?").run(TENANT_ID);
    console.log("   ✓ Cleared\n");
  }

  const insertReport = db.prepare(`
    INSERT INTO reports (id, tenant_id, resident_id, text, category_hint, address_hint, lat, lng,
                         status, created_at, classified_at, urgency, category, subcategory,
                         routed_to, summary, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertRun = db.prepare(`
    INSERT INTO classification_runs (id, tenant_id, report_count, llm_calls, tokens_estimate, duration_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const stats = { total: 0, byCategory: {} as Record<string, number>, byRoute: {} as Record<string, number> };

  // Leave ~10% as pending (not classified yet)
  const pendingCount = Math.floor(TOTAL_REPORTS * 0.1);
  const pendingIndices = new Set<number>();
  while (pendingIndices.size < pendingCount) {
    pendingIndices.add(rand(TOTAL_REPORTS - 20, TOTAL_REPORTS - 1)); // pending ones are recent
  }

  const tx = db.transaction(() => {
    for (let i = 0; i < TOTAL_REPORTS; i++) {
      const tmpl = pickTemplate();
      const loc = pickLocation();
      const isPending = pendingIndices.has(i);

      const id = `report-seed-${nanoid(8)}`;
      const text = pick(tmpl.texts);
      const createdAt = generateTimestamp(DAYS_BACK, tmpl.time_bias);
      const residentId = pick(RESIDENT_IDS);

      // Jitter on lat/lng — wider spread to cover more area
      const lat = loc.lat + (Math.random() - 0.5) * 0.004;
      const lng = loc.lng + (Math.random() - 0.5) * 0.004;

      // ~15% of reports have no location
      const hasLocation = Math.random() > 0.15;

      const urgency = rand(tmpl.urgency_min, tmpl.urgency_max);
      const confidence = randFloat(tmpl.confidence_min, tmpl.confidence_max);
      const summary = buildSummary(text);

      // Classified reports get a classified_at 1-30 min after created_at
      const classifiedAt = isPending
        ? null
        : new Date(new Date(createdAt).getTime() + rand(60, 1800) * 1000).toISOString();

      insertReport.run(
        id,
        TENANT_ID,
        residentId,
        text,
        tmpl.category,                         // category_hint
        hasLocation ? loc.address : null,       // address_hint
        hasLocation ? lat : null,               // lat
        hasLocation ? lng : null,               // lng
        isPending ? "pending" : "classified",   // status
        createdAt,
        classifiedAt,
        isPending ? null : urgency,
        isPending ? null : tmpl.category,
        isPending ? null : tmpl.subcategory,
        isPending ? null : tmpl.route_to,
        isPending ? null : summary,
        isPending ? null : confidence,
      );

      stats.total++;
      stats.byCategory[tmpl.category] = (stats.byCategory[tmpl.category] ?? 0) + 1;
      stats.byRoute[tmpl.route_to] = (stats.byRoute[tmpl.route_to] ?? 0) + 1;
    }

    // Insert a couple of fake classification runs
    const runDates = [
      new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
    ];
    for (const runDate of runDates) {
      insertRun.run(
        `run-seed-${nanoid(6)}`,
        TENANT_ID,
        rand(10, 30),     // report_count
        rand(1, 3),        // llm_calls
        rand(2000, 8000),  // tokens_estimate
        rand(800, 3500),   // duration_ms
        runDate,
      );
    }
  });

  tx();

  // Print stats
  console.log(`   ✅ Inserted ${stats.total} reports (${pendingCount} pending, ${stats.total - pendingCount} classified)`);
  console.log(`\n   📊 By category:`);
  for (const [cat, count] of Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${cat.padEnd(16)} ${count}`);
  }
  console.log(`\n   🔀 By route:`);
  for (const [route, count] of Object.entries(stats.byRoute).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${route.padEnd(24)} ${count}`);
  }

  // Verify
  const total = (db.prepare("SELECT COUNT(*) as c FROM reports WHERE tenant_id = ?").get(TENANT_ID) as { c: number }).c;
  const pending = (db.prepare("SELECT COUNT(*) as c FROM reports WHERE tenant_id = ? AND status = 'pending'").get(TENANT_ID) as { c: number }).c;
  console.log(`\n   🔍 Verification: ${total} total in DB, ${pending} pending`);
  console.log(`\n🌱 Seed complete!\n`);
}

try {
  seed();
} catch (err) {
  console.error("❌ Seed failed:", (err as Error).message);
  process.exit(1);
} finally {
  closeDb();
}
