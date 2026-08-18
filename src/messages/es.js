/**
 * Spanish. Neutral register, addressing the reader as "tú" — the page speaks
 * plainly in English and should not turn formal in translation.
 *
 * Every key here is also in en.js; keys that are missing fall back to English
 * rather than disappearing, so this file may lag without breaking the page.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const MESSAGES_ES = Object.freeze({
  "lang.name": "Español",

  "r.redirecting": "Redirigiendo",
  "r.takingYou": "Te llevamos a",
  "r.where": "Adónde lleva este enlace",
  "r.nothingLoaded": "Todavía no se ha cargado nada. Comprueba el destino antes de continuar.",
  "r.check": "Revisa este enlace antes de continuar",
  "r.worthLook": "Tiene algo que merece una segunda mirada:",
  "r.openExternal": "¿Abrir este enlace?",
  "r.externalApp": "Abre una aplicación externa ({scheme}). Continúa solo si confías en ella.",
  "r.signed": "Este enlace está firmado",
  "r.signedNote":
    "Todavía no se ha cargado nada. Comprueba la firma, o continúa sin ella.",
  "r.continue": "Continuar",
  "r.makeLink": "Crear un enlace",
  "r.passphrasePrompt":
    "Este enlace está firmado. Introduce la contraseña para comprobarlo.",
  "r.passphrase": "contraseña",
  "r.checkButton": "Comprobar",

  "tag.ok": "Comprobación de integridad correcta: este enlace no ha sido alterado.",
  "tag.unverified":
    "Este navegador no puede comprobar la etiqueta de integridad del enlace, " +
    "así que queda sin verificar.",
  "tag.altered": "Este enlace ha sido alterado",
  "tag.alteredNote":
    "Su comprobación de integridad no coincide, así que no es el enlace que se " +
    "compartió. Puede haberse cortado por el camino, o haberse editado.",
  "sig.ok": "Firma verificada: hecha por alguien que conoce esta contraseña.",
  "sig.bad": "La firma no coincide con esta contraseña.",

  "err.damaged": "Este enlace está dañado.",
  "err.damagedAddress": "Este enlace está dañado: su dirección no es válida.",
  "err.wrong": "Algo ha fallado al abrir este enlace.",
  "err.update": "Algo ha fallado: prueba a editar la URL.",
  "err.notEncoded": "No se ha podido codificar eso.",

  "risk.userinfo":
    "La parte anterior a la \"@\" no es el destino. Este enlace lleva en realidad a {host}.",
  "risk.homograph":
    "Esta dirección mezcla alfabetos, así que algunos caracteres pueden no ser " +
    "las letras que parecen.",
  "risk.impersonation":
    "Esta dirección contiene \"{brand}\", pero el sitio que abre en realidad es {host}.",
  "risk.ip-literal":
    "Este enlace apunta a una dirección IP en bruto, no a un sitio con nombre.",
  "risk.port": "Se conecta por el puerto {port} en lugar del habitual.",
  "risk.insecure": "La conexión es HTTP sin cifrar.",

  "m.pasteLabel": "Pega una URL larga",
  "m.clean": "Quitar parámetros de seguimiento",
  "m.cleanNote": "utm_*, fbclid, gclid y similares",
  "m.cleanNoDeflate":
    "utm_*, fbclid, gclid · este navegador no puede usar DEFLATE, " +
    "así que los enlaces serán más largos",
  "m.preview": "Enlace de vista previa",
  "m.previewNote": "muestra el destino en lugar de ir a él",
  "m.tamper": "Comprobación de manipulación",
  "m.tamperNote": "4 caracteres; detecta un enlace cortado o editado",
  "m.style": "Estilo de enlace",
  "m.styleStandard": "Estándar",
  "m.styleDense": "Denso",
  "m.styleEmoji": "Emoji",
  "m.styleNotePlain": "Base64url; sobrevive a cualquier aplicación y portapapeles",
  "m.styleNoteDense": "≈7% más corto usando puntuación de URL; algunas aplicaciones de chat cortan los enlaces ahí",
  "m.styleNoteEmoji": "una cuarta parte menos de caracteres que mirar; algunas aplicaciones estropean los emoji",
  "m.shorter": "{saved} caracteres más corto",
  "m.shorterCleaned1": "{saved} caracteres más corto, tras quitar 1 parámetro de seguimiento",
  "m.shorterCleaned":
    "{saved} caracteres más corto, tras quitar {removed} parámetros de seguimiento",
  "m.sameLength": "Exactamente la misma longitud.",
  "m.longer":
    "{longer} caracteres más largo. Esta URL ya es lo bastante corta como para que " +
    "llevarla entera cueste más de lo que ahorra.",
  "m.willWarn": "Quien abra este enlace verá primero un aviso: {reasons}",
  "m.veryLong":
    "Con {length} caracteres, algunas aplicaciones de chat y servidores antiguos " +
    "pueden cortar este enlace.",
  "m.copy": "Copiar",
  "m.copied": "Copiado",
  "m.qr": "QR",
  "m.language": "Idioma",
});
