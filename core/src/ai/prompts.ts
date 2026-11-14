import type { Task } from '../models.ts';

// Fixed, byte-stable instructions (no dates/ids) so prompt caching can hit.
// Shared prefix first; per-task instruction appended. Variable data goes only in the user message.
export const SHARED_SYSTEM = `Eres el motor de ContentHub Pro, un estudio de contenido para un creador en Colombia (Huila).
Reglas: responde SOLO con el JSON pedido, sin explicaciones. Español claro, directo, sin relleno.
No inventes datos ni cifras: si el insumo no las trae, no las des. Piensa en consumo en celular.`;

export const TASK_PROMPTS: Record<Task, string> = {
  trends:
    'Recibes una lista numerada de datos reales (id|fuente|titulo|metrica). Propón hasta 5 temas de conversación masiva usando SOLO esos datos: cada tema debe citar en sourceIds los ids que lo respaldan (mínimo 1). No inventes hechos ni cifras. Si los datos son pocos o no sirven, devuelve menos temas. context: una frase basada en los datos. virality es tu estimación 0-10 del potencial, no una medición.',
  treatment:
    'Para el tema dado, propón 3 tratamientos: myth (contraste/mito), analogy (analogía cotidiana), history (gancho histórico). Cada uno con título, gancho de una línea y por qué funciona.',
  audience:
    'Describe el perfil de audiencia probable para el tema y el anclaje dado. Plataformas recomendadas y riesgos. Breve.',
  formats:
    'Recomienda formato, duración (segundos) y plataforma entre tiktok, instagram, facebook, youtube_short, youtube_long, spotify. Máximo 4 recomendaciones.',
  script:
    'Escribe 2 opciones de guion (A dinámico/retención, B analítico/guardable). Cada una: gancho 0-3s, beats con tiempo, visual y texto, CTA y caption. Respeta la duración pedida.',
  metricsAnalysis:
    'Recibes un resumen ya calculado de métricas (no datos crudos). Explica qué funcionó, qué cambiar y 3 ideas siguientes. Usa solo cifras del resumen.',
  sourceHighlights:
    'Recibes un fragmento de transcripción con marcas [mm:ss]. Extrae máximo 6 momentos con valor propio (afirmaciones fuertes, historias, datos, preguntas). startSec/endSec en segundos según las marcas. point: una frase.',
  contentIdeas:
    'Recibes la transcripción (o los momentos clave) de un archivo del creador, con marcas [mm:ss] o [h:mm:ss]. Resume en 2 frases y propón de 6 a 8 piezas de contenido distintas. Cada una: plataforma (tiktok, instagram, facebook, youtube_short, youtube_long, spotify), formato, gancho de una línea, startSec/endSec del tramo fuente (0 si no hay tiempos) y por qué funciona. Prioriza momentos con gancho propio. No inventes nada que no esté en el material.',
  publishCopy:
    'Para cada plataforma recibida escribe el texto de publicación en español de Colombia: título corto (si la plataforma lo usa), caption listo para pegar (gancho en la primera línea, máximo 3 líneas, CTA al final), 4-6 hashtags sin # inicial y la franja horaria sugerida (hora de Colombia) como sugerencia, no como dato medido. Respeta el estilo de cada plataforma; en spotify escribe la descripción del episodio.',
  verifyClaims:
    'Recibes escenas de un guion, una por línea con formato clave|texto. Para cada escena: si contiene datos verificables (cifras, fechas, nombres, relaciones de causa y efecto), enumera cada afirmación y busca en la web fuentes fiables (prefiere oficiales, científicas o primarias). Por fuente da el título de la página, la URL EXACTA tal como aparece en los resultados de búsqueda o en la página que abriste (la app volverá a abrirla y comprobará el dato) y, si pudiste leer la página, una cita corta y textual que respalde la afirmación; si no pudiste abrirla, deja quote vacío (no escribas una cita de memoria). Incluye como fuente toda página de los resultados que trate el tema de la afirmación, aunque no la hayas abierto. Nunca inventes URLs ni citas: si no encuentras fuente, deja sources vacío. Si una cifra la calculas tú (conversión, suma, promedio), explícalo en calc como «cálculo propio: …»; si no hay cálculo, calc es una cadena vacía. Si la escena no tiene datos (opinión, saludo, llamada a la acción), opinion es true y claims queda vacío. Devuelve una entrada por cada clave recibida y copia la clave exacta.',
};
