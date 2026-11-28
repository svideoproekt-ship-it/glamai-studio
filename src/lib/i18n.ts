// i18n v49 — языки интерфейса студии: русский, английский, немецкий, французский.
//
// Зачем: приём платежей Звёздами работает по всему миру, значит и интерфейс
// должен говорить с клиентом на его языке. Язык выбирается так:
//  1) ручной выбор (кнопки RU/EN/DE/FR, хранится в localStorage);
//  2) язык приложения Telegram (language_code из initDataUnsafe.user);
//  3) язык браузера (navigator.language).
// Цепочка подстановки: выбранный язык → английский → русский. Если для
// какого-то ключа перевод ещё не дописан, интерфейс не ломается — показывает
// английский (или русский) текст.
//
// Серверные сообщения (благодарность после оплаты, напоминание замершим)
// берут язык из glam_users.language_code — его пишет вход через Mini App.

export type Lang = "ru" | "en" | "de" | "fr";

export const LANGS: Array<{ id: Lang; label: string }> = [
  { id: "ru", label: "RU" },
  { id: "en", label: "EN" },
  { id: "de", label: "DE" },
  { id: "fr", label: "FR" },
];

const LANG_SET = new Set<string>(["ru", "en", "de", "fr"]);

/** "ru-RU" | "de-DE" | "kk" | … → один из четырёх языков студии. */
export function detectLang(tag: string | null | undefined): Lang {
  const t = (tag ?? "").toLowerCase();
  if (t.startsWith("ru") || t.startsWith("be") || t.startsWith("uk") || t.startsWith("kk")) return "ru";
  if (t.startsWith("de")) return "de";
  if (t.startsWith("fr")) return "fr";
  return "en";
}

export function isLang(value: string | null | undefined): value is Lang {
  return !!value && LANG_SET.has(value);
}

export const LANG_STORAGE_KEY = "glam_lang";

/** Клиентский выбор языка: localStorage → Telegram → браузер. */
export function pickClientLang(hints?: { telegram?: string | null; browser?: string | null }): Lang {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(LANG_STORAGE_KEY);
  } catch {
    /* приватный режим — просто без запоминания */
  }
  if (isLang(stored)) return stored;
  if (hints?.telegram && hints.telegram.length <= 8) {
    return detectLang(hints.telegram);
  }
  return detectLang(hints?.browser ?? "");
}

export function saveLang(lang: Lang): void {
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* не критично */
  }
}

type Vars = Record<string, string | number>;

/** Словарь: ключ → { ru, en, de, fr }. Подстановка: {имя} в тексте. */
const DICT: Record<string, Record<Lang, string>> = {
  // ---------- Общие ----------
  "app.tagline": {
    ru: "ИИ-визажист для студии макияжа",
    en: "AI makeup artist for makeup studios",
    de: "KI-Visagistin für Make-up-Studios",
    fr: "Visagiste IA pour studios de maquillage",
  },

  // ---------- Экран входа ----------
  "login.h1": {
    ru: "Примерка макияжа для ваших клиенток — за 30 секунд",
    en: "Virtual makeup try-on for your clients — in 30 seconds",
    de: "Make-up-Anprobe für deine Kundinnen — in 30 Sekunden",
    fr: "Essayage de maquillage pour vos clientes — en 30 secondes",
  },
  "login.b1": {
    ru: "3 бесплатных образа — без карты и обязательств",
    en: "3 free looks — no card, no strings attached",
    de: "3 kostenlose Looks — ohne Karte und ohne Verpflichtungen",
    fr: "3 looks gratuits — sans carte ni engagement",
  },
  "login.b2": {
    ru: "Палитра профессиональных оттенков или перенос макияжа с референса",
    en: "Pro shade palette or makeup transfer from a reference photo",
    de: "Professionelle Farbpalette oder Make-up-Transfer vom Referenzfoto",
    fr: "Palette de teintes pro ou transfert du maquillage depuis une référence",
  },
  "login.b3": {
    ru: "Лицо клиента сохраняется, фото не хранятся на сервере",
    en: "The client's face stays intact — photos are never stored on the server",
    de: "Das Gesicht bleibt erhalten — Fotos werden nicht auf dem Server gespeichert",
    fr: "Le visage reste fidèle — les photos ne sont pas conservées sur le serveur",
  },
  "login.b4": {
    ru: "Показывайте клиентке варианты до встречи — она приходит с готовым решением",
    en: "Show clients options before the appointment — they arrive with a decision made",
    de: "Zeigen Sie der Kundin Varianten vor dem Termin — sie kommt mit einer fertigen Entscheidung",
    fr: "Montrez des variantes avant le rendez-vous — la cliente arrive avec son choix fait",
  },
  "login.loading": {
    ru: "Загружаем студию…",
    en: "Loading the studio…",
    de: "Studio wird geladen…",
    fr: "Chargement du studio…",
  },
  "login.signingIn": {
    ru: "Входим через Telegram…",
    en: "Signing in with Telegram…",
    de: "Anmeldung über Telegram…",
    fr: "Connexion via Telegram…",
  },
  "login.slowHint": {
    ru: "Вход затянулся. Закрой студию и открой её через бота ещё раз (кнопка «Открыть студию»), либо открой сайт в обычном браузере.",
    en: "This is taking long. Close the studio and reopen it via the bot ('Open studio' button), or open the site in a regular browser.",
    de: "Das dauert zu lange. Schließe das Studio und öffne es erneut über den Bot („Studio öffnen“) oder öffne die Seite in einem normalen Browser.",
    fr: "Cela prend trop de temps. Fermez le studio et rouvrez-le via le bouton « Ouvrir le studio » du bot, ou ouvrez le site dans un navigateur classique.",
  },
  "login.tgBrowser": {
    ru: "Студия открылась внутри Telegram без автоматического входа. Закрой этот экран и в чате с ботом нажми кнопку «Открыть студию» (внизу слева от поля ввода) — тогда вход пройдёт сам, без кодов и подтверждений.",
    en: "The studio opened inside Telegram without automatic sign-in. Close this screen and tap the 'Open studio' button in the bot chat (bottom-left, near the input field) — sign-in will then happen by itself, no codes needed.",
    de: "Das Studio hat sich in Telegram ohne automatische Anmeldung geöffnet. Schließe diesen Bildschirm und tippe im Bot-Chat auf „Studio öffnen“ (unten links neben dem Eingabefeld) — dann meldet du dich automatisch an, ohne Codes.",
    fr: "Le studio s'est ouvert dans Telegram sans connexion automatique. Fermez cet écran et appuyez sur le bouton « Ouvrir le studio » dans le chat du bot (en bas à gauche) — la connexion se fera toute seule, sans codes.",
  },
  "login.loadingBtn": {
    ru: "Загружаем кнопку входа Telegram…",
    en: "Loading the Telegram login button…",
    de: "Telegram-Login-Button wird geladen…",
    fr: "Chargement du bouton de connexion Telegram…",
  },
  "login.detecting": {
    ru: "Определяем способ входа…",
    en: "Detecting the sign-in method…",
    de: "Anmeldeart wird ermittelt…",
    fr: "Détection de la méthode de connexion…",
  },
  "login.noConfig": {
    ru: "Вход не настроен: задайте переменные TELEGRAM_BOT_USERNAME, TELEGRAM_BOT_TOKEN и AUTH_SECRET (инструкция — в README-DEPLOY-RU.md) и сделайте Redeploy.",
    en: "Sign-in is not configured: set TELEGRAM_BOT_USERNAME, TELEGRAM_BOT_TOKEN and AUTH_SECRET (see README-DEPLOY-RU.md), then redeploy.",
    de: "Anmeldung ist nicht konfiguriert: TELEGRAM_BOT_USERNAME, TELEGRAM_BOT_TOKEN und AUTH_SECRET setzen (siehe README-DEPLOY-RU.md) und neu deployen.",
    fr: "Connexion non configurée : définissez TELEGRAM_BOT_USERNAME, TELEGRAM_BOT_TOKEN et AUTH_SECRET (voir README-DEPLOY-RU.md), puis redéployez.",
  },
  "login.confirmNote": {
    ru: "Вход подтверждает, что вы мастер. Клиентские фото не сохраняются.",
    en: "Sign-in confirms you are a makeup artist. Client photos are never stored.",
    de: "Die Anmeldung bestätigt, dass du Visagist:in bist. Kundenfotos werden nicht gespeichert.",
    fr: "La connexion confirme que vous êtes maquilleur·se. Les photos des clientes ne sont pas conservées.",
  },
  "login.retryHint": {
    ru: "Telegram не подтвердил вход. Закрой студию и открой её через кнопку бота ещё раз.",
    en: "Telegram didn't confirm the sign-in. Close the studio and reopen it via the bot button.",
    de: "Telegram hat die Anmeldung nicht bestätigt. Schließe das Studio und öffne es erneut über den Bot-Button.",
    fr: "Telegram n'a pas confirmé la connexion. Fermez le studio et rouvrez-le via le bouton du bot.",
  },
  "login.networkHint": {
    ru: "Не удалось связаться с сервером входа. Проверь интернет и открой студию через кнопку бота ещё раз.",
    en: "Couldn't reach the sign-in server. Check your internet and reopen the studio via the bot button.",
    de: "Der Anmeldeserver ist nicht erreichbar. Prüfe das Internet und öffne das Studio erneut über den Bot-Button.",
    fr: "Serveur de connexion injoignable. Vérifiez Internet et rouvrez le studio via le bouton du bot.",
  },
  "authErr.config": {
    ru: "Вход не настроен на сервере: не заданы TELEGRAM_BOT_TOKEN или AUTH_SECRET. Инструкция — в README-DEPLOY-RU.md.",
    en: "Sign-in is not configured on the server: TELEGRAM_BOT_TOKEN or AUTH_SECRET is missing. See README-DEPLOY-RU.md.",
    de: "Anmeldung auf dem Server nicht konfiguriert: TELEGRAM_BOT_TOKEN oder AUTH_SECRET fehlt. Siehe README-DEPLOY-RU.md.",
    fr: "Connexion non configurée sur le serveur : TELEGRAM_BOT_TOKEN ou AUTH_SECRET manquant. Voir README-DEPLOY-RU.md.",
  },
  "authErr.telegram": {
    ru: "Telegram не подтвердил вход (подпись не сошлась). Попробуйте ещё раз.",
    en: "Telegram didn't confirm the sign-in (signature mismatch). Please try again.",
    de: "Telegram hat die Anmeldung nicht bestätigt (Signatur passt nicht). Bitte erneut versuchen.",
    fr: "Telegram n'a pas confirmé la connexion (signature invalide). Réessayez.",
  },
  "authErr.db": {
    ru: "База подписок недоступна. Если вы только что задали DATABASE_URL — сделайте Redeploy.",
    en: "The subscription database is unavailable. If you just set DATABASE_URL — redeploy.",
    de: "Die Abonnement-Datenbank ist nicht erreichbar. Wenn DATABASE_URL gerade gesetzt wurde — neu deployen.",
    fr: "La base des abonnements est indisponible. Si vous venez de définir DATABASE_URL — redéployez.",
  },
  "authErr.default": {
    ru: "Не удалось войти. Попробуйте ещё раз.",
    en: "Sign-in failed. Please try again.",
    de: "Anmeldung fehlgeschlagen. Bitte erneut versuchen.",
    fr: "Échec de la connexion. Réessayez.",
  },

  // ---------- Переключатель языков ----------
  "lang.label": { ru: "Язык", en: "Language", de: "Sprache", fr: "Langue" },

  // ---------- Шапка ----------
  "app.privacyChip": {
    ru: "Фото не сохраняются · обработка в момент запроса",
    en: "Photos are never stored · processed on the fly",
    de: "Fotos werden nicht gespeichert · Verarbeitung in Echtzeit",
    fr: "Photos non conservées · traitement à la demande",
  },
  "app.trialChip": {
    ru: "Пробные: {n} из {t}",
    en: "Free: {n} of {t}",
    de: "Kostenlos: {n} von {t}",
    fr: "Gratuits : {n} sur {t}",
  },
  "app.until": { ru: "до {d}", en: "until {d}", de: "bis {d}", fr: "jusqu'au {d}" },
  "app.logout": { ru: "Выйти", en: "Log out", de: "Abmelden", fr: "Déconnexion" },

  // ---------- Плашка студии-источника ----------
  "strip.invited": {
    ru: "Вас пригласила студия «{name}» — образы можно примерить прямо здесь, а запись сделать у её мастеров.",
    en: "{name} invited you — try on looks right here and book a visit with their artists.",
    de: "„{name}“ hat dich eingeladen — probiere Looks direkt hier an und buche einen Termin bei den Visagist:innen.",
    fr: "« {name} » vous invite — essayez les looks ici même et réservez chez ses artistes.",
  },
  "strip.book": { ru: "Записаться", en: "Book now", de: "Termin buchen", fr: "Réserver" },

  // ---------- Баннер остатка ----------
  "banner.free": {
    ru: "Бесплатно: {n} из {t} образов",
    en: "Free: {n} of {t} looks",
    de: "Kostenlos: {n} von {t} Looks",
    fr: "Gratuits : {n} sur {t} looks",
  },
  "banner.hasLeft": {
    ru: " — без карты. Дальше — пакеты от {stars} ★",
    en: " — no card needed. Then packs from {stars} ★",
    de: " — ohne Karte. Danach Pakete ab {stars} ★",
    fr: " — sans carte. Ensuite, packs dès {stars} ★",
  },
  "banner.expired": {
    ru: " — пробные образы закончились.",
    en: " — your free looks are used up.",
    de: " — deine kostenlosen Looks sind aufgebraucht.",
    fr: " — vos looks gratuits sont épuisés.",
  },
  "banner.choose": {
    ru: "Выбрать тариф",
    en: "Choose a pack",
    de: "Paket wählen",
    fr: "Choisir une formule",
  },
  "banner.bookIn": {
    ru: "Записаться в «{name}»",
    en: "Book at {name}",
    de: "Termin bei „{name}“ buchen",
    fr: "Réserver chez {name}",
  },

  // ---------- Вкладки и секции ----------
  "tab.prompt": {
    ru: "Промпт и палитра",
    en: "Prompt & palette",
    de: "Prompt & Palette",
    fr: "Prompt & palette",
  },
  "tab.reference": {
    ru: "Перенос с референса",
    en: "Transfer from reference",
    de: "Transfer vom Referenzbild",
    fr: "Transfert depuis une référence",
  },
  "sec.style": { ru: "Стиль, образ", en: "Style & mood", de: "Stil & Look", fr: "Style & ambiance" },
  "sec.styleHint": {
    ru: "Из выбранного образа ИИ в дальнейшем нанесёт палитру красок: стиль задаёт плотность и характер всего макияжа.",
    en: "The AI applies the palette in the style you pick: it sets the intensity and character of the whole look.",
    de: "Die KI trägt die Farbpalette im gewählten Stil auf: Er bestimmt Intensität und Charakter des gesamten Make-ups.",
    fr: "L'IA applique la palette dans le style choisi : il détermine l'intensité et le caractère du maquillage.",
  },
  "sec.face": { ru: "Лицо", en: "Face", de: "Gesicht", fr: "Visage" },
  "sec.faceHint": {
    ru: "Включите продукт и выберите оттенок — нанесётся в выбранном стиле.",
    en: "Turn on a product and pick a shade — it will be applied in the chosen style.",
    de: "Produkt aktivieren und Ton wählen — aufgetragen im gewählten Stil.",
    fr: "Activez un produit et choisissez une teinte — appliquée dans le style choisi.",
  },
  "sec.eyes": { ru: "Глаза", en: "Eyes", de: "Augen", fr: "Yeux" },
  "sec.eyesHint": {
    ru: "Формы стрелок и бровей, техника век — у каждой области своя палитра.",
    en: "Wing and brow shapes, lid techniques — each area has its own palette.",
    de: "Wing- und Brauenformen, Lidtechniken — jeder Bereich hat seine eigene Palette.",
    fr: "Formes d'eyeliners et de sourcils, techniques de paupières — chaque zone a sa palette.",
  },
  "sec.prompt": { ru: "Промпт", en: "Prompt", de: "Prompt", fr: "Prompt" },
  "prompt.placeholder": {
    ru: "Например: лёгкие смоки-айз в бронзовых тонах, акцент на глаза, нюдовые губы, сияющая кожа…",
    en: "e.g. soft bronze smoky eyes, emphasis on the eyes, nude lips, glowing skin…",
    de: "z. B. sanfte Smoky Eyes in Bronze, Augen im Fokus, Nude-Lippen, strahlende Haut…",
    fr: "ex. smoky léger bronze, yeux en accent, lèvres nude, peau lumineuse…",
  },
  "prompt.hint": {
    ru: "Слова из промпта ИИ объединит с выбранными оттенками. Генерация занимает 20–60 секунд.",
    en: "The AI merges your words with the selected shades. A look takes 20–60 seconds.",
    de: "Die KI verbindet deine Worte mit den gewählten Tönen. Ein Look dauert 20–60 Sekunden.",
    fr: "L'IA combine vos mots aux teintes choisies. Un look prend 20 à 60 secondes.",
  },
  "sec.comment": {
    ru: "Комментарий для ИИ",
    en: "Note for the AI",
    de: "Hinweis für die KI",
    fr: "Note pour l'IA",
  },
  "comment.placeholder": {
    ru: "Необязательно: например, «сделай губы чуть светлее, а стрелки — тоньше»",
    en: "Optional: e.g. 'make the lips a bit lighter and the wing thinner'",
    de: "Optional: z. B. „Lippen etwas heller, Wing dünner“",
    fr: "Facultatif : ex. « lèvres un peu plus claires, eyeliner plus fin »",
  },
  "comment.hint": {
    ru: "ИИ возьмёт макияж с референса и адаптирует его под черты лица на оригинале.",
    en: "The AI takes the makeup from the reference and adapts it to the face in the original photo.",
    de: "Die KI übernimmt das Make-up aus der Referenz und passt es dem Gesicht im Originalfoto an.",
    fr: "L'IA reprend le maquillage de la référence et l'adapte au visage de la photo d'origine.",
  },

  // ---------- Загрузка фото ----------
  "dz.model.title": { ru: "Фото модели", en: "Model photo", de: "Modelfoto", fr: "Photo du modèle" },
  "dz.model.hint": {
    ru: "лицо крупным планом, JPEG/PNG",
    en: "close-up face, JPEG/PNG",
    de: "Gesicht in Nahaufnahme, JPEG/PNG",
    fr: "visage en gros plan, JPEG/PNG",
  },
  "dz.original.title": {
    ru: "Оригинал — фото клиента",
    en: "Original — client's photo",
    de: "Original — Kundenfoto",
    fr: "Original — photo de la cliente",
  },
  "dz.original.hint": {
    ru: "чьё лицо будет в макияже",
    en: "whose face gets the makeup",
    de: "wessen Gesicht geschminkt wird",
    fr: "le visage à maquiller",
  },
  "dz.reference.title": {
    ru: "Референс макияжа",
    en: "Makeup reference",
    de: "Make-up-Referenz",
    fr: "Référence maquillage",
  },
  "dz.reference.hint": {
    ru: "образец: чей макияж переносим",
    en: "the look we're transferring",
    de: "der Look, der übertragen wird",
    fr: "le look à transférer",
  },
  "dz.drop": { ru: "Перетащите фото сюда", en: "Drop a photo here", de: "Foto hierher ziehen", fr: "Déposez une photo ici" },
  "dz.dropOver": { ru: "Отпускайте — загружаем!", en: "Drop it — uploading!", de: "Loslassen — wird geladen!", fr: "Lâchez — chargement !" },
  "dz.orPick": {
    ru: "или нажмите, чтобы выбрать файл",
    en: "or click to choose a file",
    de: "oder klicke, um eine Datei zu wählen",
    fr: "ou cliquez pour choisir un fichier",
  },
  "dz.remove": { ru: "Убрать", en: "Remove", de: "Entfernen", fr: "Retirer" },
  "dz.errDefault": {
    ru: "Не удалось загрузить изображение",
    en: "Could not load the image",
    de: "Bild konnte nicht geladen werden",
    fr: "Impossible de charger l'image",
  },

  // ---------- Генерация ----------
  "gen.fastMode": {
    ru: "Быстрый режим — без проверки качества. Тратит в 4 раза меньше лимита ИИ; включайте, если ловите «слишком много запросов».",
    en: "Fast mode — skips the quality check. Uses 4× less of the AI limit; turn it on if you hit 'too many requests'.",
    de: "Schnellmodus — ohne Qualitätsprüfung. Verbraucht 4× weniger vom KI-Limit; einschalten, wenn „zu viele Anfragen“ kommt.",
    fr: "Mode rapide — sans contrôle qualité. Consomme 4× moins de quota IA ; à activer en cas de « trop de requêtes ».",
  },
  "gen.fastModeAria": {
    ru: "Быстрый режим без проверки качества",
    en: "Fast mode without quality check",
    de: "Schnellmodus ohne Qualitätsprüfung",
    fr: "Mode rapide sans contrôle qualité",
  },
  "gen.btn": { ru: "Создать образ", en: "Create the look", de: "Look erstellen", fr: "Créer le look" },
  "gen.loading": {
    ru: "ИИ наносит макияж…",
    en: "The AI is applying makeup…",
    de: "Die KI trägt das Make-up auf…",
    fr: "L'IA applique le maquillage…",
  },
  "toast.readyTitle": { ru: "Образ готов ✨", en: "Look ready ✨", de: "Look ist fertig ✨", fr: "Look prêt ✨" },
  "toast.readyDesc": {
    ru: "Сравните «до и после» и сохраните.",
    en: "Compare before & after and save.",
    de: "Vorher-Nachher vergleichen und speichern.",
    fr: "Comparez avant/après et enregistrez.",
  },
  "toast.failTitle": { ru: "Не получилось", en: "Something went wrong", de: "Das hat nicht geklappt", fr: "Une erreur est survenue" },

  // ---------- Ошибки генерации ----------
  "err.noModelPrompt": {
    ru: "Загрузите фото модели.",
    en: "Upload a model photo.",
    de: "Lade ein Modelfoto hoch.",
    fr: "Téléchargez la photo du modèle.",
  },
  "err.noModelRef": {
    ru: "Загрузите оригинальное фото клиента.",
    en: "Upload the client's original photo.",
    de: "Lade das Originalfoto des Kunden hoch.",
    fr: "Téléchargez la photo originale de la cliente.",
  },
  "err.noRef": {
    ru: "Загрузите референс — фото с образцом макияжа.",
    en: "Upload a reference — a photo with the makeup sample.",
    de: "Lade eine Referenz hoch — ein Foto mit dem Make-up-Beispiel.",
    fr: "Téléchargez une référence — une photo avec le maquillage modèle.",
  },
  "err.noSelection": {
    ru: "Включите хотя бы один продукт в блоках «Лицо» или «Глаза» или опишите образ словами.",
    en: "Turn on at least one product in 'Face' or 'Eyes', or describe the look in words.",
    de: "Aktiviere mindestens ein Produkt in „Gesicht“ oder „Augen“ oder beschreibe den Look in Worten.",
    fr: "Activez au moins un produit dans « Visage » ou « Yeux », ou décrivez le look en mots.",
  },
  "err.session": {
    ru: "Сессия истекла — обновите страницу и войдите через Telegram заново.",
    en: "Your session expired — refresh the page and sign in via Telegram again.",
    de: "Sitzung abgelaufen — Seite aktualisieren und erneut über Telegram anmelden.",
    fr: "Session expirée — actualisez la page et reconnectez-vous via Telegram.",
  },
  "err.timeout": {
    ru: "Сервер не успел обработать запрос (таймаут платформы). Попробуйте ещё раз — обычно вторая попытка проходит.",
    en: "The server ran out of time (platform timeout). Try again — the second attempt usually goes through.",
    de: "Der Server hatte nicht genug Zeit (Plattform-Timeout). Nochmal versuchen — der zweite Versuch klappt meist.",
    fr: "Le serveur n'a pas eu le temps (timeout de la plateforme). Réessayez — la deuxième passe généralement.",
  },
  "err.tooLarge": {
    ru: "Фото слишком большое для отправки. Уменьшите размер файла и попробуйте снова.",
    en: "The photo is too large to upload. Shrink the file and try again.",
    de: "Das Foto ist zu groß zum Hochladen. Verkleinere die Datei und versuche es erneut.",
    fr: "La photo est trop volumineuse. Réduisez le fichier et réessayez.",
  },
  "err.http": {
    ru: "Сервис вернул ошибку {code}. Попробуйте ещё раз чуть позже.",
    en: "The service returned error {code}. Try again a bit later.",
    de: "Der Dienst meldete Fehler {code}. Versuche es später erneut.",
    fr: "Le service a renvoyé l'erreur {code}. Réessayez un peu plus tard.",
  },
  "err.service": {
    ru: "Сервис ИИ временно недоступен, попробуйте позже.",
    en: "The AI service is temporarily unavailable — please try later.",
    de: "Der KI-Dienst ist vorübergehend nicht verfügbar — bitte später versuchen.",
    fr: "Le service IA est momentanément indisponible — réessayez plus tard.",
  },
  "err.unknown": { ru: "Неизвестная ошибка", en: "Unknown error", de: "Unbekannter Fehler", fr: "Erreur inconnue" },
  "err.configBanner": {
    ru: "ИИ не настроен — генерация пока не сработает",
    en: "AI is not configured — generation won't work yet",
    de: "KI ist nicht konfiguriert — Generierung funktioniert noch nicht",
    fr: "IA non configurée — la génération ne fonctionnera pas encore",
  },
  "err.diag": {
    ru: "Подробная диагностика: откройте /api/health (после исправления — /api/health?ping=1, он проверит и сам ключ).",
    en: "Detailed diagnostics: open /api/health (after fixing — /api/health?ping=1, it checks the key too).",
    de: "Detaillierte Diagnose: /api/health öffnen (nach der Korrektur — /api/health?ping=1, prüft auch den Key).",
    fr: "Diagnostic détaillé : ouvrez /api/health (après correction — /api/health?ping=1, il vérifie aussi la clé).",
  },
  "err.hide": { ru: "Скрыть", en: "Hide", de: "Ausblenden", fr: "Masquer" },

  // ---------- Подвал ----------
  "footer.contact": {
    ru: "Задать вопрос — поможем с оплатой и подпиской:",
    en: "Questions? We help with payment and plans:",
    de: "Fragen? Wir helfen bei Zahlung und Tarifen:",
    fr: "Des questions ? Nous aidons pour le paiement et les formules :",
  },
  "footer.legal": {
    ru: "GlamAI Studio · Виртуальная примерка макияжа · Фото обрабатываются в момент запроса и не сохраняются на сервере",
    en: "GlamAI Studio · Virtual makeup try-on · Photos are processed on the fly and never stored",
    de: "GlamAI Studio · Virtuelle Make-up-Anprobe · Fotos werden in Echtzeit verarbeitet und nie gespeichert",
    fr: "GlamAI Studio · Essayage de maquillage virtuel · Photos traitées à la demande, jamais conservées",
  },

  // ---------- Paywall ----------
  "pw.titleDefault": {
    ru: "Бесплатные образы закончились",
    en: "Your free looks are used up",
    de: "Deine kostenlosen Looks sind aufgebraucht",
    fr: "Vos looks gratuits sont épuisés",
  },
  "pw.msgDefault": {
    ru: "Бесплатные образы закончились. Выбери пакет — генерации зачислятся мгновенно и не сгорают.",
    en: "Free looks are used up. Pick a pack — generations are credited instantly and never expire.",
    de: "Kostenlose Looks aufgebraucht. Wähle ein Paket — Looks werden sofort gutgeschrieben und verfallen nie.",
    fr: "Looks gratuits épuisés. Choisissez un pack — les looks sont crédités instantanément et n'expirent jamais.",
  },
  "pw.paywallQuota": {
    ru: "Месячный лимит тарифа исчерпан. Продлите подписку или перейдите на «Салон».",
    en: "Monthly plan limit reached. Renew your plan or upgrade to Salon.",
    de: "Monatslimit des Tarifs erreicht. Tarif verlängern oder auf „Salon“ upgraden.",
    fr: "Limite mensuelle atteinte. Renouvelez votre formule ou passez à « Salon ».",
  },
  "pw.paywallTrial": {
    ru: "Бесплатные образы закончились. Забери генерации пакетом — и продолжим.",
    en: "Your free looks are used up. Grab a pack of looks and let's continue.",
    de: "Deine kostenlosen Looks sind aufgebraucht. Hol dir ein Look-Paket — und weiter geht's.",
    fr: "Vos looks gratuits sont épuisés. Prenez un pack de looks — et on continue.",
  },
  "pw.studioTitle": {
    ru: "Образ выбран — запишитесь в «{name}»",
    en: "Look chosen — book at {name}",
    de: "Look gewählt — Termin bei „{name}“ buchen",
    fr: "Look choisi — réservez chez {name}",
  },
  "pw.studioDesc": {
    ru: "Пробные образы были бесплатны — за счёт GlamAI Studio. Дальше — визажист студии: он воплотит выбранный образ.",
    en: "The trial looks were on GlamAI Studio. Next — the studio's artist will bring your chosen look to life.",
    de: "Die Probe-Looks gingen auf Kosten von GlamAI Studio. Weiter — die Visagist:in des Studios bringt deinen Look zum Leben.",
    fr: "Les looks d'essai étaient offerts par GlamAI Studio. Ensuite — l'artiste du studio réalisera le look choisi.",
  },
  "pw.packsTitle": {
    ru: "Продолжить в студии GlamAI",
    en: "Continue in the GlamAI studio",
    de: "Weiter im GlamAI-Studio",
    fr: "Continuer dans le studio GlamAI",
  },
  "pw.packsDesc": {
    ru: "Оплата Звёздами Telegram — прямо в боте за пару нажатий. Генерации зачисляются мгновенно и не сгорают.",
    en: "Pay with Telegram Stars — right in the bot, in a couple of taps. Looks are credited instantly and never expire.",
    de: "Zahlung mit Telegram Stars — direkt im Bot, mit ein paar Tipps. Looks werden sofort gutgeschrieben und verfallen nie.",
    fr: "Payez avec des Stars Telegram — directement dans le bot, en deux gestes. Looks crédités instantanément, sans expiration.",
  },
  "pw.pack.gen1.title": { ru: "Одна генерация", en: "Single look", de: "Ein Look", fr: "Un look" },
  "pw.pack.gen1.perk": {
    ru: "попробовать прямо сейчас",
    en: "try it right now",
    de: "sofort ausprobieren",
    fr: "essayer tout de suite",
  },
  "pw.pack.five74.title": { ru: "Пять за 74", en: "Pack of 5", de: "5er-Pack", fr: "Pack de 5" },
  "pw.pack.five74.perk": {
    ru: "по 14,8 ₽ — выгоднее поштучной",
    en: "best value per look",
    de: "günstiger pro Look",
    fr: "meilleur prix par look",
  },
  "pw.pack.start46.title": { ru: "Старт", en: "Start", de: "Start", fr: "Start" },
  "pw.pack.start46.perk": {
    ru: "46 генераций — рабочий запас мастера",
    en: "46 looks — a working stock for a pro",
    de: "46 Looks — der Vorrat für Profis",
    fr: "46 looks — la réserve du pro",
  },
  "pw.pack.best": { ru: "выбор мастеров", en: "most popular", de: "beliebteste Wahl", fr: "le plus choisi" },
  "pw.opening": { ru: "Открываю…", en: "Opening…", de: "Öffne…", fr: "Ouverture…" },
  "pw.starsNote": {
    ru: "★ — Звёзды Telegram. Нет Звёзд или удобнее переводом — реквизиты ниже.",
    en: "★ are Telegram Stars. No Stars, or prefer a bank transfer? Use the details below.",
    de: "★ sind Telegram Stars. Keine Stars da oder lieber Überweisung? Nutzung die Daten unten.",
    fr: "★ = Stars Telegram. Pas de Stars ou plutôt un virement ? Utilisez les coordonnées ci-dessous.",
  },
  "pw.tabNote": {
    ru: "Счёт открыт в новой вкладке — после оплаты остаток обновится.",
    en: "The invoice opened in a new tab — your balance updates after payment.",
    de: "Die Rechnung öffnete sich in einem neuen Tab — nach der Zahlung wird das Guthaben aktualisiert.",
    fr: "La facture s'est ouverte dans un nouvel onglet — le solde sera mis à jour après le paiement.",
  },
  "pw.netNote": {
    ru: "Сеть подвела — попробуйте ещё раз или оплатите переводом ниже.",
    en: "Network hiccup — try again, or pay by transfer below.",
    de: "Netzwerkproblem — versuche es erneut oder zahle unten per Überweisung.",
    fr: "Souci de réseau — réessayez ou payez par virement ci-dessous.",
  },
  "pw.failNote": {
    ru: "Не удалось открыть счёт — попробуйте ещё раз или оплатите переводом ниже.",
    en: "Couldn't open the invoice — try again, or pay by transfer below.",
    de: "Rechnung konnte nicht geöffnet werden — erneut versuchen oder unten per Überweisung zahlen.",
    fr: "Impossible d'ouvrir la facture — réessayez ou payez par virement ci-dessous.",
  },
  "pw.sessionNote": {
    ru: "Сессия истекла — перезайдите в студию.",
    en: "Session expired — please sign in to the studio again.",
    de: "Sitzung abgelaufen — bitte erneut im Studio anmelden.",
    fr: "Session expirée — reconnectez-vous au studio.",
  },
  "pw.packErr": { ru: "Неизвестный пакет.", en: "Unknown pack.", de: "Unbekanntes Paket.", fr: "Pack inconnu." },
  "pw.notConfigured": {
    ru: "Оплата Звёздами не настроена на сервере — оплатите переводом по реквизитам ниже.",
    en: "Stars payments aren't configured on the server yet — pay by transfer using the details below.",
    de: "Stars-Zahlung ist auf dem Server noch nicht eingerichtet — zahle unten per Überweisung.",
    fr: "Le paiement par Stars n'est pas encore configuré sur le serveur — payez par virement ci-dessous.",
  },
  "pw.invoiceErr": {
    ru: "Telegram не дал открыть счёт. Попробуйте ещё раз или оплатите переводом ниже.",
    en: "Telegram didn't open the invoice. Try again, or pay by transfer below.",
    de: "Telegram konnte die Rechnung nicht öffnen. Erneut versuchen oder unten per Überweisung zahlen.",
    fr: "Telegram n'a pas pu ouvrir la facture. Réessayez ou payez par virement ci-dessous.",
  },
  "pw.planStart.title": { ru: "Старт", en: "Start", de: "Start", fr: "Start" },
  "pw.planSalon.title": { ru: "Салон", en: "Salon", de: "Salon", fr: "Salon" },
  "pw.perk.start1": {
    ru: "46 генераций — без срока",
    en: "46 looks — no expiry",
    de: "46 Looks — unbegrenzt gültig",
    fr: "46 looks — sans expiration",
  },
  "pw.perk.start2": {
    ru: "для мастера и его клиенток",
    en: "for artists and their clients",
    de: "für Profis und ihre Kundinnen",
    fr: "pour les pros et leurs clientes",
  },
  "pw.perk.start3": {
    ru: "оплата переводом (СБП)",
    en: "pay by bank transfer (RU)",
    de: "Zahlung per Überweisung (RU)",
    fr: "paiement par virement (RU)",
  },
  "pw.perk.salon1": {
    ru: "170 генераций в месяц",
    en: "170 looks per month",
    de: "170 Looks pro Monat",
    fr: "170 looks par mois",
  },
  "pw.perk.salon2": {
    ru: "каждой клиентке — 3 бесплатных примерки",
    en: "3 free try-ons for every client",
    de: "3 kostenlose Anproben pro Kundin",
    fr: "3 essayages gratuits par cliente",
  },
  "pw.perk.salon3": {
    ru: "для студии с несколькими мастерами",
    en: "for studios with several artists",
    de: "für Studios mit mehreren Visagist:innen",
    fr: "pour les studios avec plusieurs artistes",
  },
  "pw.perMonth": { ru: "/ мес", en: "/ mo", de: "/ Monat", fr: "/ mois" },
  "pw.once": { ru: "разово", en: "one-time", de: "einmalig", fr: "une fois" },
  "pw.choose": {
    ru: "Выбрать {title} — {price} ₽",
    en: "Choose {title} — {price} ₽",
    de: "{title} wählen — {price} ₽",
    fr: "Choisir {title} — {price} ₽",
  },
  "pw.manualNote": {
    ru: "«Старт» и «Салон» можно оплатить и переводом — включение вручную, обычно 5–15 минут.",
    en: "'Start' and 'Salon' can also be paid by bank transfer — manual activation, usually 5–15 minutes.",
    de: "„Start“ und „Salon“ sind auch per Überweisung möglich — manuelle Aktivierung, meist 5–15 Minuten.",
    fr: "« Start » et « Salon » sont aussi payables par virement — activation manuelle, généralement 5 à 15 minutes.",
  },
  "pw.pcNote": {
    ru: "Открываем Telegram Web — текст заявки уже скопирован, вставьте его в чат (Ctrl+V).",
    en: "Opening Telegram Web — the request text is already copied; paste it into the chat (Ctrl+V).",
    de: "Telegram Web öffnet sich — der Antragstext ist kopiert, füge ihn in den Chat ein (Strg+V).",
    fr: "Ouverture de Telegram Web — le texte de la demande est copié ; collez-le dans le chat (Ctrl+V).",
  },

  // ---------- Реквизиты ----------
  "req.title": { ru: "Как оплатить", en: "How to pay", de: "So wird bezahlt", fr: "Comment payer" },
  "req.sbpBtn": {
    ru: "Оплатить переводом по ссылке (СБП)",
    en: "Pay via bank link",
    de: "Per Bank-Link bezahlen",
    fr: "Payer via le lien bancaire",
  },
  "req.bank": { ru: "Банк", en: "Bank", de: "Bank", fr: "Banque" },
  "req.holder": { ru: "Получатель", en: "Recipient", de: "Empfänger", fr: "Bénéficiaire" },
  "req.phone": { ru: "Телефон (перевод по номеру)", en: "Phone (bank transfer)", de: "Telefon (Überweisung)", fr: "Téléphone (virement)" },
  "req.card": { ru: "Карта", en: "Card", de: "Karte", fr: "Carte" },
  "req.copy": { ru: "Копировать", en: "Copy", de: "Kopieren", fr: "Copier" },
  "req.copied": { ru: "Скопировано ✓", en: "Copied ✓", de: "Kopiert ✓", fr: "Copié ✓" },
  "req.copyPhoneAria": { ru: "Скопировать телефон", en: "Copy the phone number", de: "Telefonnummer kopieren", fr: "Copier le numéro" },
  "req.copyCardAria": { ru: "Скопировать номер карты", en: "Copy the card number", de: "Kartennummer kopieren", fr: "Copier le numéro de carte" },
  "req.stepLink1": {
    ru: "1. Нажмите кнопку выше — банк сам подставит сумму, подтвердите перевод.",
    en: "1. Tap the button above — the bank fills in the amount; confirm the transfer.",
    de: "1. Obigen Button antippen — die Bank setzt den Betrag selbst ein; Überweisung bestätigen.",
    fr: "1. Appuyez sur le bouton ci-dessus — la banque remplit le montant ; confirmez le virement.",
  },
  "req.stepLink2": {
    ru: "2. Нажмите «Выбрать тариф» — откроется чат, отправьте скриншот чека.",
    en: "2. Tap 'Choose a pack' — a chat opens; send the payment screenshot there.",
    de: "2. „Paket wählen“ antippen — ein Chat öffnet sich; schicke den Screenshot der Quittung dorthin.",
    fr: "2. Appuyez sur « Choisir une formule » — un chat s'ouvre ; envoyez la capture du reçu.",
  },
  "req.stepLink3": {
    ru: "3. Подписка включается вручную, обычно за 5–15 минут.",
    en: "3. The plan is activated manually, usually within 5–15 minutes.",
    de: "3. Der Tarif wird manuell freigeschaltet, meist in 5–15 Minuten.",
    fr: "3. La formule est activée manuellement, généralement en 5 à 15 minutes.",
  },
  "req.stepPhone1": {
    ru: "1. В приложении СВОЕГО банка выберите «Перевести по номеру телефона».",
    en: "1. In YOUR banking app, choose 'Transfer by phone number'.",
    de: "1. Wähle in DEINER Banking-App „Überweisung per Telefonnummer“.",
    fr: "1. Dans VOTRE application bancaire, choisissez « Virement par numéro de téléphone ».",
  },
  "req.stepPhone2": {
    ru: "2. Введите номер телефона ниже, сумма — как у выбранного тарифа. Банк покажет имя получателя для проверки.",
    en: "2. Enter the phone number below; the amount is the price of your chosen plan. The bank shows the recipient's name to verify.",
    de: "2. Telefonnummer unten eingeben, Betrag wie beim gewählten Tarif. Die Bank zeigt den Empfängernamen zur Kontrolle.",
    fr: "2. Saisissez le numéro ci-dessous ; le montant = celui de la formule. La banque affiche le nom du bénéficiaire.",
  },
  "req.stepPhone3": {
    ru: "3. Нажмите «Выбрать тариф» — откроется чат, отправьте скриншот чека.",
    en: "3. Tap 'Choose a pack' — a chat opens; send the payment screenshot there.",
    de: "3. „Paket wählen“ antippen — ein Chat öffnet sich; schicke den Screenshot der Quittung dorthin.",
    fr: "3. Appuyez sur « Choisir une formule » — un chat s'ouvre ; envoyez la capture du reçu.",
  },
  "req.stepPhone4": {
    ru: "4. Подписка включается вручную, обычно за 5–15 минут.",
    en: "4. The plan is activated manually, usually within 5–15 minutes.",
    de: "4. Der Tarif wird manuell freigeschaltet, meist in 5–15 Minuten.",
    fr: "4. La formule est activée manuellement, généralement en 5 à 15 minutes.",
  },
  "req.stepCard1": {
    ru: "1. Переведите сумму за месяц по реквизитам ниже.",
    en: "1. Transfer the monthly amount using the details below.",
    de: "1. Überweise den Monatsbetrag mit den Daten unten.",
    fr: "1. Virez le montant mensuel aux coordonnées ci-dessous.",
  },
  "req.stepCard2": {
    ru: "2. Нажмите «Выбрать тариф» — откроется чат, отправьте скриншот чека.",
    en: "2. Tap 'Choose a pack' — a chat opens; send the payment screenshot there.",
    de: "2. „Paket wählen“ antippen — ein Chat öffnet sich; schicke den Screenshot der Quittung dorthin.",
    fr: "2. Appuyez sur « Choisir une formule » — un chat s'ouvre ; envoyez la capture du reçu.",
  },
  "req.stepCard3": {
    ru: "3. Подписка включается вручную, обычно за 5–15 минут.",
    en: "3. The plan is activated manually, usually within 5–15 minutes.",
    de: "3. Der Tarif wird manuell freigeschaltet, meist in 5–15 Minuten.",
    fr: "3. La formule est activée manuellement, généralement en 5 à 15 minutes.",
  },
  "req.stepNone1": {
    ru: "1. Нажмите «Выбрать тариф» — откроется чат с владельцем студии.",
    en: "1. Tap 'Choose a pack' — a chat with the studio owner opens.",
    de: "1. „Paket wählen“ antippen — der Chat mit dem Studioinhaber öffnet sich.",
    fr: "1. Appuyez sur « Choisir une formule » — le chat du propriétaire s'ouvre.",
  },
  "req.stepNone2": {
    ru: "2. Вам пришлют реквизиты для перевода.",
    en: "2. You'll be sent the transfer details.",
    de: "2. Du bekommst die Überweisungsdaten zugeschickt.",
    fr: "2. Les coordonnées de virement vous seront envoyées.",
  },
  "req.stepNone3": {
    ru: "3. После оплаты подписку включат за 5–15 минут.",
    en: "3. After payment the plan is switched on within 5–15 minutes.",
    de: "3. Nach der Zahlung wird der Tarif in 5–15 Minuten freigeschaltet.",
    fr: "3. Après paiement, la formule est activée en 5 à 15 minutes.",
  },
  "req.stepNone2b": {
    ru: "2. Пришлите скриншот чека в чат с владельцем.",
    en: "2. Send the payment screenshot to the owner's chat.",
    de: "2. Schicke den Screenshot der Quittung in den Chat des Inhabers.",
    fr: "2. Envoyez la capture du reçu dans le chat du propriétaire.",
  },
  "req.qrTitle": { ru: "QR-код для оплаты", en: "QR code for payment", de: "QR-Code zur Zahlung", fr: "QR code de paiement" },
  "req.qrShow": { ru: "Показать QR-код", en: "Show QR code", de: "QR-Code zeigen", fr: "Afficher le QR code" },
  "req.qrHide": { ru: "Скрыть QR-код", en: "Hide QR code", de: "QR-Code verbergen", fr: "Masquer le QR code" },
  "req.qrCapLink": {
    ru: "С другого телефона или с компьютера: наведите камеру — банк откроется сразу с переводом.",
    en: "From another phone or a computer: point the camera — the bank opens ready for the transfer.",
    de: "Von anderem Handy oder PC: Kamera darauf richten — die Bank öffnet sich direkt mit der Überweisung.",
    fr: "Depuis un autre téléphone ou un ordinateur : visez avec l'appareil — la banque s'ouvre prête pour le virement.",
  },
  "req.qrCapPhone": {
    ru: "С другого телефона или с компьютера: наведите камеру — появится номер для перевода, вставьте его в своём банке.",
    en: "From another phone or a computer: point the camera — you'll get the transfer number to paste into your banking app.",
    de: "Von anderem Handy oder PC: Kamera darauf richten — die Überweisungsnummer erscheint; füge sie in deiner Banking-App ein.",
    fr: "Depuis un autre téléphone ou un ordinateur : visez avec l'appareil — le numéro de virement apparaît ; collez-le dans votre banque.",
  },
  "req.notSet": {
    ru: "Реквизиты не заданы на сервере. Владелец: добавьте PAYMENT_PHONE и/или PAYMENT_BANK, PAYMENT_CARD_NUMBER, PAYMENT_CARD_OWNER в Vercel → Settings → Environment Variables и сделайте Redeploy — реквизиты появятся здесь.",
    en: "Transfer details are not set on the server. Owner: add PAYMENT_PHONE and/or PAYMENT_BANK, PAYMENT_CARD_NUMBER, PAYMENT_CARD_OWNER in Vercel → Settings → Environment Variables, then redeploy.",
    de: "Überweisungsdaten sind nicht gesetzt. Inhaber: PAYMENT_PHONE und/oder PAYMENT_BANK, PAYMENT_CARD_NUMBER, PAYMENT_CARD_OWNER in Vercel → Settings → Environment Variables setzen und neu deployen.",
    fr: "Coordonnées non définies sur le serveur. Propriétaire : ajoutez PAYMENT_PHONE et/ou PAYMENT_BANK, PAYMENT_CARD_NUMBER, PAYMENT_CARD_OWNER dans Vercel → Settings → Environment Variables, puis redéployez.",
  },
  "pw.footer": {
    ru: "Звёзды Telegram — мгновенно и прямо в боте. Перевод по реквизитам — включается вручную, обычно 5–15 минут.",
    en: "Telegram Stars — instant, right in the bot. Bank transfer — manual activation, usually 5–15 minutes.",
    de: "Telegram Stars — sofort, direkt im Bot. Überweisung — manuelle Aktivierung, meist 5–15 Minuten.",
    fr: "Stars Telegram — instantané, dans le bot. Virement — activation manuelle, généralement 5 à 15 minutes.",
  },

  // ---------- Панель результата ----------
  "res.status1": { ru: "Изучаем черты лица…", en: "Reading the facial features…", de: "Gesichtszüge werden analysiert…", fr: "Analyse des traits du visage…" },
  "res.status2": { ru: "Подбираем оттенки…", en: "Picking the shades…", de: "Töne werden ausgesucht…", fr: "Choix des teintes…" },
  "res.status3": { ru: "Наносим тени…", en: "Applying the eyeshadow…", de: "Lidschatten wird aufgetragen…", fr: "Application des fards…" },
  "res.status4": { ru: "Прорисовываем стрелки…", en: "Drawing the wings…", de: "Wings werden gezeichnet…", fr: "Tracé des eyeliners…" },
  "res.status5": { ru: "Смешиваем текстуры…", en: "Blending the textures…", de: "Texturen werden verwischt…", fr: "Mélange des textures…" },
  "res.status6": { ru: "Финальный штрих…", en: "Final touch…", de: "Letzter Schliff…", fr: "Dernière touche…" },
  "res.usual": {
    ru: "Обычно занимает 20–60 секунд",
    en: "Usually takes 20–60 seconds",
    de: "Dauert meist 20–60 Sekunden",
    fr: "Prend généralement 20 à 60 secondes",
  },
  "res.empty": {
    ru: "Результат появится здесь",
    en: "Your result will appear here",
    de: "Hier erscheint das Ergebnis",
    fr: "Le résultat apparaîtra ici",
  },
  "res.shareText": { ru: "Образ GlamAI Studio 💄", en: "GlamAI Studio look 💄", de: "GlamAI Studio Look 💄", fr: "Look GlamAI Studio 💄" },
  "res.zoomEyesAria": {
    ru: "Увеличить область глаз",
    en: "Zoom in on the eyes",
    de: "Augen vergrößern",
    fr: "Zoomer sur les yeux",
  },
  "res.zoomDetailsAria": {
    ru: "Рассмотреть детали образа",
    en: "Inspect the details of the look",
    de: "Details des Looks betrachten",
    fr: "Examiner les détails du look",
  },
  "res.transferTitle": {
    ru: "Передайте образ клиенту",
    en: "Send the look to your client",
    de: "Look an Kundin senden",
    fr: "Envoyez le look à votre cliente",
  },
  "res.transferAria": {
    ru: "Передать фото клиенту",
    en: "Send the photo to the client",
    de: "Foto an Kundin senden",
    fr: "Envoyer la photo à la cliente",
  },
  "res.linkBtn": { ru: "Получить ссылку", en: "Get link", de: "Link holen", fr: "Obtenir le lien" },
  "res.linkBusy": { ru: "Готовим ссылку…", en: "Preparing link…", de: "Link wird vorbereitet…", fr: "Lien en préparation…" },
  "res.linkReady": { ru: "Ссылка готова", en: "Link ready", de: "Link bereit", fr: "Lien prêt" },
  "res.linkAria": {
    ru: "Получить ссылку на фото для клиента",
    en: "Get a photo link for the client",
    de: "Fotolink für die Kundin holen",
    fr: "Obtenir le lien photo pour la cliente",
  },
  "res.saveAria": {
    ru: "Сохранить образ в галерею устройства",
    en: "Save the look to the device gallery",
    de: "Look in die Gerätegalerie speichern",
    fr: "Enregistrer le look dans la galerie",
  },
  "res.linkReadyMsg": {
    ru: "Ссылка готова — отправьте её клиенту в любом мессенджере или откройте сами и нажмите «Сохранить фото».",
    en: "Link ready — send it to your client in any messenger, or open it yourself and tap 'Save photo'.",
    de: "Link bereit — schicke ihn der Kundin in einem Messenger oder öffne ihn selbst und tippe auf „Foto speichern“.",
    fr: "Lien prêt — envoyez-le à votre cliente dans n'importe quel messagerie, ou ouvrez-le et appuyez sur « Enregistrer la photo ».",
  },
  "res.linkCopied": {
    ru: "Ссылка скопирована — вставьте её в сообщение клиенту.",
    en: "Link copied — paste it into a message to your client.",
    de: "Link kopiert — füge ihn in eine Nachricht an die Kundin ein.",
    fr: "Lien copié — collez-le dans un message à votre cliente.",
  },
  "res.linkFail": {
    ru: "Не удалось создать ссылку, попробуйте ещё раз.",
    en: "Couldn't create the link — please try again.",
    de: "Link konnte nicht erstellt werden — bitte erneut versuchen.",
    fr: "Impossible de créer le lien — réessayez.",
  },
  "res.netFail": {
    ru: "Не удалось связаться с сервером, попробуйте ещё раз.",
    en: "Couldn't reach the server — please try again.",
    de: "Server nicht erreichbar — bitte erneut versuchen.",
    fr: "Serveur injoignable — réessayez.",
  },
  "res.sendFail": {
    ru: "Не удалось отправить, попробуйте ещё раз.",
    en: "Couldn't send — please try again.",
    de: "Senden fehlgeschlagen — bitte erneut versuchen.",
    fr: "Échec de l'envoi — réessayez.",
  },
  "res.sentToBot": {
    ru: "Фото в чате с ботом — открыли его для вас: «Переслать» клиенту или сохранить в галерею через меню фото.",
    en: "The photo is in the bot chat — we opened it for you: 'Forward' it to the client or save it to the gallery via the photo menu.",
    de: "Das Foto ist im Bot-Chat — für dich geöffnet: „Weiterleiten“ an die Kundin oder über das Fotomenü in die Galerie speichern.",
    fr: "La photo est dans le chat du bot — on l'a ouverte pour vous : « Transférer » à la cliente ou enregistrez-la via le menu de la photo.",
  },
  "res.iosHold": {
    ru: "Удерживайте палец на фото — телефон предложит «Сохранить» (срабатывает не везде). Надёжнее всего — «Получить ссылку»: фото откроется в браузере с кнопкой «Сохранить фото».",
    en: "Press and hold the photo — the phone will offer 'Save' (works not everywhere). The most reliable way is 'Get link': the photo opens in the browser with a 'Save photo' button.",
    de: "Finger auf dem Foto halten — das Handy bietet „Speichern“ an (funktioniert nicht überall). Am zuverlässigsten: „Link holen“ — das Foto öffnet sich im Browser mit „Foto speichern“.",
    fr: "Appuyez longuement sur la photo — le téléphone proposera « Enregistrer » (pas partout). Le plus fiable : « Obtenir le lien » — la photo s'ouvre dans le navigateur avec « Enregistrer la photo ».",
  },
  "res.iosMenu": {
    ru: "Фото уже в чате с ботом — открыли его для вас. Нажмите на фото → «Поделиться» → «Сохранить изображение» — фото окажется в галерее.",
    en: "The photo is already in the bot chat — we opened it for you. Tap the photo → 'Share' → 'Save image' — it lands in your gallery.",
    de: "Das Foto ist schon im Bot-Chat — für dich geöffnet. Foto antippen → „Teilen“ → „Bild speichern“ — es landet in der Galerie.",
    fr: "La photo est déjà dans le chat du bot — on l'a ouverte pour vous. Touchez la photo → « Partager » → « Enregistrer l'image » — elle arrive dans la galerie.",
  },
  "res.androidMenu": {
    ru: "Фото уже в чате с ботом — открыли его для вас. Откройте фото на весь экран → меню (три точки) → «Сохранить в галерею».",
    en: "The photo is already in the bot chat — we opened it for you. Open it fullscreen → menu (three dots) → 'Save to gallery'.",
    de: "Das Foto ist schon im Bot-Chat — für dich geöffnet. Vollbild öffnen → Menü (drei Punkte) → „In Galerie speichern“.",
    fr: "La photo est déjà dans le chat du bot — on l'a ouverte pour vous. Plein écran → menu (trois points) → « Enregistrer dans la galerie ».",
  },
  "res.browserIos": {
    ru: "Открыли фото в браузере: нажмите «Сохранить фото» — или удерживайте палец на фото → «Добавить в Фото». Этой же ссылкой можно отправить фото клиенту.",
    en: "The photo opened in the browser: tap 'Save photo' — or press and hold the photo → 'Add to Photos'. The same link works to send the photo to your client.",
    de: "Das Foto öffnete sich im Browser: „Foto speichern“ tippen — oder Finger auf dem Foto halten → „Zu Fotos hinzufügen“. Derselbe Link schickt das Foto an die Kundin.",
    fr: "La photo s'est ouverte dans le navigateur : appuyez sur « Enregistrer la photo » — ou appui long → « Ajouter aux photos ». Le même lien sert à envoyer la photo à la cliente.",
  },
  "res.browserOther": {
    ru: "Открыли фото в браузере: нажмите «Сохранить фото» — оно окажется в галерее. Этой же ссылкой можно отправить фото клиенту.",
    en: "The photo opened in the browser: tap 'Save photo' — it lands in your gallery. The same link works to send the photo to your client.",
    de: "Das Foto öffnete sich im Browser: „Foto speichern“ tippen — es landet in der Galerie. Derselbe Link schickt das Foto an die Kundin.",
    fr: "La photo s'est ouverte dans le navigateur : appuyez sur « Enregistrer la photo » — elle arrive dans la galerie. Le même lien sert pour la cliente.",
  },
  "res.downloaded": {
    ru: "Фото в «Загрузках» — оно видно в галерее, и его можно вложить в сообщение мессенджера.",
    en: "The photo is in Downloads — visible in your gallery and ready to attach in any messenger.",
    de: "Das Foto ist in den Downloads — in der Galerie sichtbar und als Messenger-Anhang nutzbar.",
    fr: "La photo est dans les Téléchargements — visible dans la galerie et prête à joindre à un message.",
  },
  "res.noDirect": {
    ru: "Прямое скачивание здесь недоступно — открыли фото крупно: удерживайте палец → «Сохранить в галерею».",
    en: "Direct download isn't available here — we opened the photo fullscreen: press and hold → 'Save to gallery'.",
    de: "Direktes Speichern ist hier nicht möglich — das Foto ist im Vollbild geöffnet: Finger halten → „In Galerie speichern“.",
    fr: "Téléchargement direct indisponible ici — la photo est en plein écran : appui long → « Enregistrer dans la galerie ».",
  },
  "res.bookingTitle": {
    ru: "Образ выбран — запишитесь в «{name}»",
    en: "Look chosen — book at {name}",
    de: "Look gewählt — Termin bei „{name}“ buchen",
    fr: "Look choisi — réservez chez {name}",
  },
  "res.bookingDesc": {
    ru: "Визажист студии воплотит этот образ. Первые 3 примерки — за счёт GlamAI Studio.",
    en: "The studio's artist will bring this look to life. The first 3 try-ons are on GlamAI Studio.",
    de: "Die Visagist:in des Studios setzt diesen Look um. Die ersten 3 Anproben gehen auf GlamAI Studio.",
    fr: "L'artiste du studio réalisera ce look. Les 3 premiers essayages sont offerts par GlamAI Studio.",
  },
  "res.altLook": { ru: "Образ GlamAI", en: "GlamAI look", de: "GlamAI-Look", fr: "Look GlamAI" },
  "res.altZoom": {
    ru: "Образ GlamAI Studio крупным планом",
    en: "GlamAI Studio look close-up",
    de: "GlamAI Studio Look in Nahaufnahme",
    fr: "Look GlamAI Studio en gros plan",
  },
  "res.eyesBtn": { ru: "Глаза крупно", en: "Eyes close-up", de: "Augen groß", fr: "Yeux en gros" },
  "res.detailsBtn": {
    ru: "Рассмотреть детали",
    en: "Inspect details",
    de: "Details ansehen",
    fr: "Examiner les détails",
  },
  "res.zoomHint": {
    ru: "Стрелки, подводка и растяжка тонов лучше всего видны вблизи: нажмите на фото или «Глаза крупно» — откроется лупа. Двойное нажатие приближает место касания, ещё одно возвращает обратно; один палец двигает фото, кнопки + и − дают точный масштаб.",
    en: "Wings, eyeliner and tone gradients are best seen up close: tap the photo or 'Eyes close-up' — the magnifier opens. Double-tap zooms to the touch point, another double-tap zooms back; one finger pans the photo, + and − set the exact scale.",
    de: "Wings, Eyeliner und Tonverläufe sieht man am besten nah: Foto antippen oder „Augen groß“ — die Lupe öffnet sich. Doppeltes Tippen zoomt zur Berührungsstelle, nochmaliges Doppeltippen zurück; ein Finger verschiebt das Foto, + und − setzen den genauen Maßstab.",
    fr: "Eyeliners et dégradés se voient mieux de près : touchez la photo ou « Yeux en gros » — la loupe s'ouvre. Double-tap pour zoomer au point touché, encore une fois pour revenir ; un doigt déplace la photo, + et − règlent l'échelle.",
  },
  "res.saveGallery": {
    ru: "Сохранить в галерею",
    en: "Save to gallery",
    de: "In Galerie speichern",
    fr: "Enregistrer dans la galerie",
  },
  "res.newLook": { ru: "Новый образ", en: "New look", de: "Neuer Look", fr: "Nouveau look" },
  "res.linkPanel": {
    ru: "Ссылка на фото (действует 7 дней):",
    en: "Photo link (valid for 7 days):",
    de: "Fotolink (7 Tage gültig):",
    fr: "Lien photo (valable 7 jours) :",
  },
  "res.copyBtn": { ru: "Скопировать", en: "Copy", de: "Kopieren", fr: "Copier" },
  "res.openBrowser": {
    ru: "Открыть в браузере",
    en: "Open in browser",
    de: "Im Browser öffnen",
    fr: "Ouvrir dans le navigateur",
  },
  "res.seenOnRef": {
    ru: "Что ИИ увидел на референсе",
    en: "What the AI saw in the reference",
    de: "Was die KI in der Referenz erkannt hat",
    fr: "Ce que l'IA a vu dans la référence",
  },
  "res.usedPrompt": {
    ru: "Использованный промпт",
    en: "Prompt used",
    de: "Verwendeter Prompt",
    fr: "Prompt utilisé",
  },
  "res.portraitNote": {
    ru: "Режим портрета: тариф Z.AI на вашем сервере не поддерживает правку фотографии, поэтому образ создан как фотореалистичный портрет по описанию внешности с вашего фото. Лицо может немного отличаться от оригинала.",
    en: "Portrait mode: your server's Z.AI plan doesn't support photo editing, so the look was created as a photorealistic portrait based on the appearance described from your photo. The face may differ slightly from the original.",
    de: "Porträtmodus: Der Z.AI-Tarif deines Servers unterstützt keine Fotobearbeitung — der Look entstand als fotorealistisches Porträt nach der Beschreibung deines Fotos. Das Gesicht kann leicht abweichen.",
    fr: "Mode portrait : l'offre Z.AI de votre serveur ne supporte pas l'édition photo — le look a été créé comme portrait photoréaliste d'après la description de votre photo. Le visage peut différer légèrement.",
  },
  "res.step1": {
    ru: "Загрузите фото модели или клиента",
    en: "Upload a model or client photo",
    de: "Modell- oder Kundenfoto hochladen",
    fr: "Téléchargez une photo de modèle ou de cliente",
  },
  "res.step2": {
    ru: "Соберите образ в палитре или с референсом",
    en: "Build the look in the palette or from a reference",
    de: "Stelle den Look in der Palette oder mit Referenz zusammen",
    fr: "Composez le look dans la palette ou avec une référence",
  },
  "res.step3": {
    ru: "Сравните «до и после» и сохраните",
    en: "Compare before & after and save",
    de: "Vorher-Nachher vergleichen und speichern",
    fr: "Comparez avant/après et enregistrez",
  },
  "sv.hintShare": {
    ru: "В меню выберите «Сохранить изображение» — фото попадёт в галерею.",
    en: "In the menu choose 'Save image' — the photo lands in your gallery.",
    de: "Wähle im Menü „Bild speichern“ — das Foto landet in der Galerie.",
    fr: "Dans le menu, choisissez « Enregistrer l'image » — la photo arrive dans la galerie.",
  },

  // ---------- Лист передачи фото ----------
  "ts.closeAria": { ru: "Закрыть", en: "Close", de: "Schließen", fr: "Fermer" },
  "ts.linkReadyShort": {
    ru: "Ссылка готова — она под фото",
    en: "Link ready — it's under the photo",
    de: "Link bereit — er liegt unter dem Foto",
    fr: "Lien prêt — il est sous la photo",
  },
  "ts.sendBot": {
    ru: "Отправить ботом в Telegram",
    en: "Send via the Telegram bot",
    de: "Per Bot in Telegram senden",
    fr: "Envoyer via le bot Telegram",
  },
  "ts.sending": { ru: "Отправляем…", en: "Sending…", de: "Wird gesendet…", fr: "Envoi…" },
  "ts.linkForClient": {
    ru: "Получить ссылку для клиента",
    en: "Get a link for the client",
    de: "Link für die Kundin holen",
    fr: "Obtenir le lien pour la cliente",
  },
  "ts.linkHint": {
    ru: "Ссылка доносит фото до клиента в ЛЮБОЙ мессенджер — WhatsApp, MAX, почту: клиент откроет её и сохранит фото одной кнопкой. Ссылка живёт 7 дней. После создания она появится под фото — скопируйте и вставьте в сообщение.",
    en: "The link delivers the photo to the client in ANY messenger — WhatsApp, MAX, email: the client opens it and saves the photo with one button. The link lives 7 days. Once created it appears under the photo — copy and paste it into your message.",
    de: "Der Link bringt das Foto in JEDELEN Messenger — WhatsApp, MAX, E-Mail: die Kundin öffnet ihn und speichert das Foto mit einem Klick. Der Link gilt 7 Tage. Danach erscheint er unter dem Foto — kopieren und in die Nachricht einfügen.",
    fr: "Le lien transmet la photo à la cliente dans N'IMPORTE QUEL messagerie — WhatsApp, MAX, e-mail : elle l'ouvre et enregistre la photo d'un bouton. Le lien vit 7 jours. Une fois créé, il apparaît sous la photo — copiez-le et collez-le.",
  },
  "ts.botHint": {
    ru: "Фото придёт в чат с ботом, и мы откроем его сами. Оттуда: «Переслать» клиенту — или сохраните фото в галерею через меню фото (Android: три точки → «Сохранить в галерею»; iPhone: «Поделиться» → «Сохранить изображение»).",
    en: "The photo will arrive in the bot chat, and we'll open it for you. From there: 'Forward' it to the client — or save it to the gallery via the photo menu (Android: three dots → 'Save to gallery'; iPhone: 'Share' → 'Save image').",
    de: "Das Foto kommt in den Bot-Chat und wir öffnen es für dich. Von dort: „Weiterleiten“ an die Kundin — oder über das Fotomenü in die Galerie speichern (Android: drei Punkte → „In Galerie speichern“; iPhone: „Teilen“ → „Bild speichern“).",
    fr: "La photo arrivera dans le chat du bot, et nous l'ouvrirons pour vous. Ensuite : « Transférer » à la cliente — ou enregistrez-la via le menu de la photo (Android : trois points → « Enregistrer dans la galerie » ; iPhone : « Partager » → « Enregistrer l'image »).",
  },
  "ts.saveDevice": {
    ru: "Сохранить фото на устройство",
    en: "Save the photo to the device",
    de: "Foto auf dem Gerät speichern",
    fr: "Enregistrer la photo sur l'appareil",
  },
  "ts.saveDeviceHint": {
    ru: "Затем в мессенджере или почте нажмите «скрепка» → «Галерея» и выберите сохранённое фото. Ссылка не может вложить файл сама — так устроены все мессенджеры.",
    en: "Then in your messenger or email tap the paperclip → 'Gallery' and pick the saved photo. A link can't attach a file by itself — that's how all messengers work.",
    de: "Dann im Messenger oder E-Mail-Programm auf die Büroklammer → „Galerie“ tippen und das gespeicherte Foto wählen. Ein Link kann selbst keine Datei anhängen — so arbeiten alle Messenger.",
    fr: "Ensuite, dans le messagerie ou l'e-mail, appuyez sur le trombone → « Galerie » et choisissez la photo enregistrée. Un lien ne peut pas joindre un fichier — c'est ainsi que fonctionnent tous les messageries.",
  },
  "ts.mail": { ru: "Почта", en: "Email", de: "E-Mail", fr: "E-mail" },
  "ts.dupLink": {
    ru: "Дублируем ссылку в чат (или вложите само фото после сохранения):",
    en: "Also copy the link into the chat (or attach the photo itself after saving):",
    de: "Link zusätzlich in den Chat (oder das Foto nach dem Speichern anhängen):",
    fr: "Copiez aussi le lien dans le chat (ou joignez la photo après l'avoir enregistrée) :",
  },
  "ts.dupFile": {
    ru: "После сохранения в галерею откройте мессенджер и вложите фото скрепкой:",
    en: "After saving to the gallery, open your messenger and attach the photo:",
    de: "Nach dem Speichern in der Galerie den Messenger öffnen und das Foto anhängen:",
    fr: "Après enregistrement dans la galerie, ouvrez le messagerie et joignez la photo :",
  },
  "ts.openChat": {
    ru: "Открыть чат сразу (фото вкладывается скрепкой в самом чате):",
    en: "Open the chat right away (the photo is attached as a file in the chat itself):",
    de: "Chat sofort öffnen (das Foto wird direkt im Chat als Datei angehängt):",
    fr: "Ouvrir le chat tout de suite (la photo est jointe directement dans le chat) :",
  },
  "ts.shareText": {
    ru: "Вот ваш образ GlamAI Studio 💄 — откройте ссылку и сохраните фото: {url}",
    en: "Here's your GlamAI Studio look 💄 — open the link and save the photo: {url}",
    de: "Hier ist dein GlamAI Studio Look 💄 — öffne den Link und speichere das Foto: {url}",
    fr: "Voici votre look GlamAI Studio 💄 — ouvrez le lien et enregistrez la photo : {url}",
  },
  "ts.shareTextNoLink": {
    ru: "Вот ваш образ GlamAI Studio 💄 — фото вкладываю следом",
    en: "Here's your GlamAI Studio look 💄 — photo attached",
    de: "Hier ist dein GlamAI Studio Look 💄 — Foto im Anhang",
    fr: "Voici votre look GlamAI Studio 💄 — photo jointe",
  },
  "ts.mailSubject": {
    ru: "Ваш образ GlamAI Studio",
    en: "Your GlamAI Studio look",
    de: "Dein GlamAI Studio Look",
    fr: "Votre look GlamAI Studio",
  },
  "ts.mailBody": {
    ru: "Здравствуйте!\n\nВаш образ GlamAI Studio — по ссылке (фото доступно 7 дней): {url}\n\nGlamAI Studio",
    en: "Hello!\n\nYour GlamAI Studio look — via the link (the photo is available for 7 days): {url}\n\nGlamAI Studio",
    de: "Hallo!\n\nDein GlamAI Studio Look — über den Link (das Foto ist 7 Tage verfügbar): {url}\n\nGlamAI Studio",
    fr: "Bonjour !\n\nVotre look GlamAI Studio — via le lien (la photo est disponible 7 jours) : {url}\n\nGlamAI Studio",
  },
  "ts.mailBodyNoLink": {
    ru: "Здравствуйте!\n\nВаш образ GlamAI Studio — во вложении к письму.\n\nGlamAI Studio",
    en: "Hello!\n\nYour GlamAI Studio look — attached to this email.\n\nGlamAI Studio",
    de: "Hallo!\n\nDein GlamAI Studio Look — im Anhang der E-Mail.\n\nGlamAI Studio",
    fr: "Bonjour !\n\nVotre look GlamAI Studio — en pièce jointe.\n\nGlamAI Studio",
  },

  // ---------- Публичная страница фото (/f/<id>) ----------
  "sv.save": { ru: "Сохранить фото", en: "Save photo", de: "Foto speichern", fr: "Enregistrer la photo" },
  "sv.busy": { ru: "Готовим…", en: "Preparing…", de: "Vorbereiten…", fr: "Préparation…" },
  "sv.hintDownload": {
    ru: "Фото скачано — оно в «Загрузках» и уже видно в галерее телефона.",
    en: "Photo downloaded — it's in Downloads and visible in the phone gallery.",
    de: "Foto heruntergeladen — es ist in den Downloads und in der Galerie sichtbar.",
    fr: "Photo téléchargée — elle est dans les Téléchargements et visible dans la galerie.",
  },
  "sv.hintHold": {
    ru: "Если меню не открылось — просто удерживайте палец на фото и выберите «Сохранить».",
    en: "If the menu didn't open — press and hold the photo and choose 'Save'.",
    de: "Falls sich das Menü nicht öffnete — Finger auf dem Foto halten und „Speichern“ wählen.",
    fr: "Si le menu ne s'est pas ouvert — appuyez longuement sur la photo et choisissez « Enregistrer ».",
  },
  "sv.zoomAria": {
    ru: "Рассмотреть образ вблизи",
    en: "View the look up close",
    de: "Look aus der Nähe betrachten",
    fr: "Voir le look de près",
  },
  "sv.zoomAria2": {
    ru: "Сохранить фото в галерею телефона",
    en: "Save the photo to the phone gallery",
    de: "Foto in der Handygalerie speichern",
    fr: "Enregistrer la photo dans la galerie",
  },
  "sv.expired": { ru: "Ссылка устарела", en: "This link has expired", de: "Link abgelaufen", fr: "Lien expiré" },
  "sv.tagline": {
    ru: "Ваш готовый образ от визажиста",
    en: "Your finished look from your makeup artist",
    de: "Dein fertiger Look von der Visagistin",
    fr: "Votre look final de votre maquilleur·se",
  },
  "sv.holdAlt": {
    ru: "Либо просто удерживайте палец на фото и выберите «Сохранить в галерею» / «Добавить в Фото».",
    en: "Or simply press and hold the photo and choose 'Save to gallery' / 'Add to Photos'.",
    de: "Oder einfach den Finger auf dem Foto halten und „In Galerie speichern“ / „Zu Fotos hinzufügen“ wählen.",
    fr: "Ou appuyez longuement sur la photo et choisissez « Enregistrer dans la galerie » / « Ajouter aux photos ».",
  },
  "sv.expires": {
    ru: "Фото доступно по этой ссылке до {until} — потом оно автоматически стирается с сервера. Успейте сохранить.",
    en: "The photo is available via this link until {until} — then it is automatically erased from the server. Save it in time.",
    de: "Das Foto ist über diesen Link bis {until} verfügbar — danach wird es automatisch vom Server gelöscht. Rechtzeitig speichern.",
    fr: "La photo est disponible via ce lien jusqu'au {until} — ensuite elle est automatiquement effacée du serveur. Enregistrez-la à temps.",
  },
  "sv.expiredBody": {
    ru: "Фото по ссылке хранится 7 дней, потом автоматически стирается — мы бережём личные фотографии. Попросите мастера отправить свежую ссылку: новый образ создаётся за минуту.",
    en: "A photo lives at its link for 7 days, then is erased automatically — we protect personal photos. Ask your makeup artist to send a fresh link: a new look takes a minute.",
    de: "Ein Foto lebt 7 Tage unter seinem Link und wird dann automatisch gelöscht — wir schützen persönliche Fotos. Bittet die Visagistin um einen frischen Link: ein neuer Look dauert eine Minute.",
    fr: "Une photo vit 7 jours sous son lien, puis est effacée automatiquement — nous protégeons les photos personnelles. Demandez à votre maquilleur·se un nouveau lien : un look se crée en une minute.",
  },
  "sv.openStudio": { ru: "Открыть студию", en: "Open the studio", de: "Studio öffnen", fr: "Ouvrir le studio" },
  "sv.shareTitle": {
    ru: "Ваш образ GlamAI Studio",
    en: "Your GlamAI Studio look",
    de: "Dein GlamAI Studio Look",
    fr: "Votre look GlamAI Studio",
  },

  // ---------- Лупа (ZoomViewer) ----------
  "zoom.aria": { ru: "Просмотр образа с увеличением", en: "Zoomed look viewer", de: "Vergrößerte Look-Ansicht", fr: "Vue agrandie du look" },
  "zoom.title": { ru: "Лупа деталей", en: "Detail magnifier", de: "Detail-Lupe", fr: "Loupe détails" },
  "zoom.close": { ru: "Закрыть просмотр", en: "Close viewer", de: "Ansicht schließen", fr: "Fermer la vue" },
  "zoom.out": { ru: "Уменьшить", en: "Zoom out", de: "Verkleinern", fr: "Dézoomer" },
  "zoom.reset": { ru: "Сбросить масштаб", en: "Reset zoom", de: "Zoom zurücksetzen", fr: "Réinitialiser le zoom" },
  "zoom.in": { ru: "Увеличить", en: "Zoom in", de: "Vergrößern", fr: "Zoomer" },

  // ---------- Конструктор: подписи областей ----------
  "ctor.lashesOpt": { ru: "Форма стрелок", en: "Wing shape", de: "Wing-Form", fr: "Forme de l'eyeliner" },
  "ctor.browsOpt": { ru: "Форма бровей", en: "Brow shape", de: "Brauenform", fr: "Forme des sourcils" },
  "ctor.lidsOpt": { ru: "Техника нанесения", en: "Application technique", de: "Auftragstechnik", fr: "Technique d'application" },
  "ctor.customShade": { ru: "Свой оттенок", en: "Custom shade", de: "Eigener Ton", fr: "Teinte perso" },
  "ctor.toolsTitle": { ru: "Инструменты", en: "Tools", de: "Werkzeuge", fr: "Outils" },
  "ctor.enableAria": { ru: "Включить: {name}", en: "Turn on: {name}", de: "Aktivieren: {name}", fr: "Activer : {name}" },
  "ctor.shadeAria": { ru: "{product}: {shade}", en: "{product}: {shade}", de: "{product}: {shade}", fr: "{product} : {shade}" },
  "ctor.customAria": { ru: "Свой оттенок: {product}", en: "Custom shade: {product}", de: "Eigener Ton: {product}", fr: "Teinte perso : {product}" },

  // ---------- Стили ----------
  "style.1": { ru: "Натуральный", en: "Natural", de: "Natürlich", fr: "Naturel" },
  "style.2": { ru: "Дневной", en: "Daytime", de: "Alltag", fr: "De jour" },
  "style.3": { ru: "Вечерний", en: "Evening", de: "Abend", fr: "De soirée" },
  "style.4": { ru: "Подиумный", en: "Runway", de: "Runway", fr: "Défilé" },
  "style.5": { ru: "Возрастной", en: "Age-friendly", de: "Altersgerecht", fr: "Anti-âge" },

  // ---------- Продукты ----------
  "prod.lips.label": { ru: "Помада", en: "Lipstick", de: "Lippenstift", fr: "Rouge à lèvres" },
  "prod.lips.desc": { ru: "цвет и финиш губ", en: "lip color & finish", de: "Lippenfarbe & Finish", fr: "couleur et fini des lèvres" },
  "prod.eyeshadow.label": { ru: "Тени", en: "Eyeshadow", de: "Lidschatten", fr: "Fards à paupières" },
  "prod.eyeshadow.desc": { ru: "оттенок и финиш век", en: "lid shade & finish", de: "Lidton & Finish", fr: "teinte et fini des paupières" },
  "prod.eyeliner.label": { ru: "Подводка / стрелки", en: "Eyeliner / wings", de: "Eyeliner / Wings", fr: "Traceur / ailes" },
  "prod.eyeliner.desc": { ru: "акцент вдоль ресниц", en: "accent along the lashes", de: "Akzent entlang der Wimpern", fr: "accent le long des cils" },
  "prod.mascara.label": { ru: "Тушь", en: "Mascara", de: "Mascara", fr: "Mascara" },
  "prod.mascara.desc": { ru: "объём и разделение ресниц", en: "volume & lash separation", de: "Volumen & Wimperntrennung", fr: "volume et séparation des cils" },
  "prod.brows.label": { ru: "Брови", en: "Brows", de: "Brauen", fr: "Sourcils" },
  "prod.brows.desc": { ru: "форма и оттенок", en: "shape & shade", de: "Form & Ton", fr: "forme et teinte" },
  "prod.blush.label": { ru: "Румяна", en: "Blush", de: "Rouge", fr: "Blush" },
  "prod.blush.desc": { ru: "свежий оттенок щёк", en: "fresh cheek tint", de: "frischer Wangenton", fr: "teinte fraîche des joues" },
  "prod.contour.label": { ru: "Скульптор", en: "Contour", de: "Konturierung", fr: "Contouring" },
  "prod.contour.desc": { ru: "контуринг скул и челюсти", en: "cheek & jaw contouring", de: "Kontur von Wangen & Kiefer", fr: "contour des joues et mâchoire" },
  "prod.highlighter.label": { ru: "Хайлайтер", en: "Highlighter", de: "Highlighter", fr: "Enlumineur" },
  "prod.highlighter.desc": { ru: "сияние на скулах", en: "glow on the cheekbones", de: "Glanz auf den Wangenknochen", fr: "éclat des pommettes" },

  // ---------- Области глаз ----------
  "area.lashes.label": { ru: "Ресницы", en: "Lashes", de: "Wimpern", fr: "Cils" },
  "area.lashes.desc": { ru: "стрелки и тушь", en: "wings & mascara", de: "Wings & Mascara", fr: "eyeliner et mascara" },
  "area.brows.label": { ru: "Брови", en: "Brows", de: "Brauen", fr: "Sourcils" },
  "area.brows.desc": { ru: "форма и оттенок", en: "shape & shade", de: "Form & Ton", fr: "forme et teinte" },
  "area.lids.label": { ru: "Веки", en: "Lids", de: "Lider", fr: "Paupières" },
  "area.lids.desc": { ru: "техника теней и оттенок", en: "eyeshadow technique & shade", de: "Lidschatten-Technik & Ton", fr: "technique et teinte des paupières" },

  // ---------- Варианты стрелок/бровей/век ----------
  "opt.lashes.none": { ru: "Без стрелки — только тушь", en: "No wing — mascara only", de: "Kein Wing — nur Mascara", fr: "Sans aile — mascara seul" },
  "opt.lashes.classic": { ru: "Классическая стрелка", en: "Classic wing", de: "Klassischer Wing", fr: "Aile classique" },
  "opt.lashes.double": { ru: "Двойная стрелка", en: "Double wing", de: "Doppelter Wing", fr: "Double aile" },
  "opt.lashes.arabic": { ru: "Арабская стрелка", en: "Arabic wing", de: "Arabischer Wing", fr: "Aile arabe" },
  "opt.lashes.cat": { ru: "Кошачий глаз", en: "Cat eye", de: "Cat-Eye", fr: "Œil de chat" },
  "opt.lashes.hollywood": { ru: "Голливудская стрелка", en: "Hollywood wing", de: "Hollywood-Wing", fr: "Aile hollywoodienne" },
  "opt.lashes.egyptian": { ru: "Египетская стрелка", en: "Egyptian wing", de: "Ägyptischer Wing", fr: "Aile égyptienne" },
  "opt.lashes.smoky": { ru: "Дымчатая растушёвка", en: "Smoky smudge", de: "Smoky-Auslauf", fr: "Fumé estompé" },
  "opt.brows.straight": { ru: "Прямые", en: "Straight", de: "Gerade", fr: "Droits" },
  "opt.brows.horizontal": { ru: "Горизонтальные", en: "Horizontal", de: "Horizontal", fr: "Horizontaux" },
  "opt.brows.arched": { ru: "Дугообразные", en: "Softly arched", de: "Leicht geschwungen", fr: "Légèrement arqués" },
  "opt.brows.curved": { ru: "Изогнутые домиком", en: "High arch", de: "Hoch gebogen", fr: "Très arqués" },
  "opt.brows.wide": { ru: "Широкие густые", en: "Wide & full", de: "Breit & dicht", fr: "Larges et fournis" },
  "opt.brows.thin": { ru: "Тонкие изящные", en: "Thin & refined", de: "Dünn & fein", fr: "Fins et délicats" },
  "opt.brows.natural": { ru: "Естественные пушистые", en: "Natural & fluffy", de: "Natürlich & fluffig", fr: "Naturels et duveteux" },
  "opt.lids.banana": { ru: "Банан", en: "Banana", de: "Banane", fr: "Banane" },
  "opt.lids.loop": { ru: "Петля", en: "Loop", de: "Schleife", fr: "Boucle" },
  "opt.lids.bat": { ru: "Летучая мышь", en: "Bat wing", de: "Fledermaus", fr: "Aile de chauve-souris" },
  "opt.lids.smoky": { ru: "Дымка (смоки-айс)", en: "Smoky eyes", de: "Smoky Eyes", fr: "Smoky" },
  "opt.lids.cut": { ru: "Кутикс (cut crease)", en: "Cut crease", de: "Cut Crease", fr: "Cut crease" },
  "opt.lids.hollywood": { ru: "Голливудская дымка", en: "Hollywood depth", de: "Hollywood-Tiefe", fr: "Profondeur hollywoodienne" },

  // ---------- Инструменты ----------
  "tool.fluffy.label": { ru: "Пушистая кисть", en: "Fluffy brush", de: "Weicher Pinsel", fr: "Pinceau flou" },
  "tool.fluffy.hint": { ru: "мягкая растушёвка теней", en: "soft shadow blending", de: "weiches Verwischen der Lidschatten", fr: "estompage doux des fards" },
  "tool.flat.label": { ru: "Плоская кисть", en: "Flat brush", de: "Flacher Pinsel", fr: "Pinceau plat" },
  "tool.flat.hint": {
    ru: "чёткие грани и аккуратная укладка цвета",
    en: "crisp edges, precise color placement",
    de: "klare Kanten, präzise Farbabsetzung",
    fr: "bords nets, pose précise de la couleur",
  },
  "tool.sponge.label": { ru: "Спонж", en: "Blending sponge", de: "Beauty-Sponger", fr: "Éponge" },
  "tool.sponge.hint": {
    ru: "аэрографный тон без полос",
    en: "airbrushed base, no streaks",
    de: "airbrushartige Basis ohne Streifen",
    fr: "base aérographe sans traces",
  },
  "tool.pencil.label": { ru: "Карандаш", en: "Pencil", de: "Stift", fr: "Crayon" },
  "tool.pencil.hint": { ru: "прорисовка мелких деталей", en: "fine detailing", de: "feine Details", fr: "détails fins" },
  "tool.fan.label": { ru: "Веерная кисть", en: "Fan brush", de: "Fächerpinsel", fr: "Pinceau éventail" },
  "tool.fan.hint": {
    ru: "лёгкая вуаль хайлайтера",
    en: "a light veil of highlighter",
    de: "hauchfeiner Highlighter-Schleier",
    fr: "voile léger d'enlumineur",
  },
  "tool.spoolie.label": { ru: "Щёточка для бровей", en: "Spoolie", de: "Brauenbürste", fr: "Brosse à sourcils" },
  "tool.spoolie.hint": {
    ru: "естественные зачёсанные брови",
    en: "natural brushed-up brows",
    de: "natürlich gebürstete Brauen",
    fr: "sourcils naturels brossés",
  },

  // ---------- Финиш и плотность ----------
  "finish.matte": { ru: "Матовый", en: "Matte", de: "Matt", fr: "Mat" },
  "finish.satin": { ru: "Сатиновый", en: "Satin", de: "Satin", fr: "Satiné" },
  "finish.gloss": { ru: "Глянцевый", en: "Glossy", de: "Glänzend", fr: "Brillant" },
  "finish.shimmer": { ru: "Мерцающий", en: "Shimmer", de: "Shimmer", fr: "Irisé" },
  "intensity.1": { ru: "Лёгкий", en: "Light", de: "Dezent", fr: "Léger" },
  "intensity.2": { ru: "Средний", en: "Medium", de: "Mittel", fr: "Medium" },
  "intensity.3": { ru: "Яркий", en: "Bold", de: "Intens", fr: "Intense" },

  // ---------- Подписки (плашка) ----------
  "plan.trial": { ru: "Пробный", en: "Trial", de: "Testzugang", fr: "Essai" },
  "plan.start": { ru: "Старт", en: "Start", de: "Start", fr: "Start" },
  "plan.salon": { ru: "Салон", en: "Salon", de: "Salon", fr: "Salon" },

  // ---------- Серверные тексты (БД/webhook/cron) ----------
  "srv.invoice.desc": {
    ru: "{n} генераций образа. Зачисление на баланс мгновенно, генерации не сгорают.",
    en: "{n} looks. Credited to your balance instantly, they never expire.",
    de: "{n} Looks. Sofort auf dein Guthaben gebucht, sie verfallen nie.",
    fr: "{n} looks. Crédités instantanément sur votre solde, ils n'expirent jamais.",
  },
  "srv.invoice.price": { ru: "{title} ({n} генераций)", en: "{title} ({n} looks)", de: "{title} ({n} Looks)", fr: "{title} ({n} looks)" },
  "srv.thanks": {
    ru: "Готово, {name}! Зачислили «{pack}» — +{n} генераций. Теперь на балансе {rest}.\n\nОткрой студию и продолжай: примерки не сгорают.",
    en: "Done, {name}! '{pack}' credited — +{n} looks. Your balance is now {rest}.\n\nOpen the studio and keep going: looks never expire.",
    de: "Fertig, {name}! „{pack}“ gutgeschrieben — +{n} Looks. Dein Guthaben: {rest}.\n\nÖffne das Studio und leg los: Looks verfallen nie.",
    fr: "C'est fait, {name} ! « {pack} » crédité — +{n} looks. Votre solde : {rest}.\n\nOuvrez le studio et continuez : les looks n'expirent pas.",
  },
  "srv.remind1": {
    ru: "{name}, в твоей студии GlamAI осталась 1 бесплатная генерация — а образ, который ты выбирала, ждёт.\n\nОткрой бот кнопкой «Открыть студию» и доведи примерку до конца: подберёшь свой макияж и сохранишь готовый образ.",
    en: "{name}, you have 1 free look left in your GlamAI studio — and the look you picked is waiting.\n\nOpen the bot via the 'Open studio' button and finish your try-on: fine-tune your makeup and save the final look.",
    de: "{name}, in deinem GlamAI-Studio ist noch 1 kostenloser Look übrig — und der Look, den du ausgesucht hattest, wartet.\n\nÖffne den Bot über „Studio öffnen“ und beende die Anprobe: stimme dein Make-up ab und speichere den fertigen Look.",
    fr: "{name}, il vous reste 1 look gratuit dans votre studio GlamAI — et le look que vous aviez choisi vous attend.\n\nOuvrez le bot via « Ouvrir le studio » et terminez l'essayage : ajustez votre maquillage et enregistrez le look final.",
  },
  "srv.remindN": {
    ru: "{name}, в твоей студии GlamAI осталось {n} генераций — а образ, который ты выбирала, ждёт.\n\nОткрой бот кнопкой «Открыть студию» и доведи примерку до конца: подберёшь свой макияж и сохранишь готовый образ.",
    en: "{name}, you have {n} looks left in your GlamAI studio — and the look you picked is waiting.\n\nOpen the bot via the 'Open studio' button and finish your try-on: fine-tune your makeup and save the final look.",
    de: "{name}, in deinem GlamAI-Studio sind noch {n} Looks übrig — und der Look, den du ausgesucht hattest, wartet.\n\nÖffne den Bot über „Studio öffnen“ und beende die Anprobe: stimme dein Make-up ab und speichere den fertigen Look.",
    fr: "{name}, il vous reste {n} looks dans votre studio GlamAI — et le look que vous aviez choisi vous attend.\n\nOuvrez le bot via « Ouvrir le studio » et terminez l'essayage : ajustez votre maquillage et enregistrez le look final.",
  },
};

/** Перевод с подстановкой {имя} и цепочкой lang → en → ru. */
export function t(lang: Lang, key: string, vars?: Vars): string {
  const row = DICT[key];
  let text: string | undefined = row?.[lang];
  if (text === undefined) text = row?.en;
  if (text === undefined) text = row?.ru;
  if (text === undefined) return key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

/** Список статусов загрузки (ResultPanel) в нужном языке. */
export function loadingStatuses(lang: Lang): string[] {
  return [1, 2, 3, 4, 5, 6].map((i) => t(lang, `res.status${i}`));
}

/** Русские формы слова «генерация»: 1 генерация / 2 генерации / 5 генераций. */
export function genWordRu(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "генерация";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "генерации";
  return "генераций";
}

/** «46 генераций» / «46 looks» / «46 Looks» / «46 looks» — для чипов и инвойсов. */
export function genCount(lang: Lang, n: number): string {
  if (lang === "ru") return `${n} ${genWordRu(n)}`;
  if (lang === "de") return n === 1 ? "1 Look" : `${n} Looks`;
  return n === 1 ? "1 look" : `${n} looks`;
}

/** Название пакета на языке клиента (fallback — русское из тарифов). */
export function packTitle(lang: Lang, packId: string): string {
  const key = `pw.pack.${packId}.title`;
  const row = DICT[key];
  return row?.[lang] ?? row?.en ?? packId;
}

/** Название тарифа для плашки подписки. */
export function planTitle(lang: Lang, plan: string): string {
  if (plan === "start" || plan === "salon") return t(lang, `plan.${plan}`);
  return t(lang, "plan.trial");
}

// ---------- Конструктор: хелперы над данными makeup.ts ----------

/** Название стиля (id 1–5). */
export function styleLabel(lang: Lang, id: number): string {
  return t(lang, `style.${id}`);
}

/** Название и описание продукта («Помада», «цвет и финиш губ»). */
export function productLabel(lang: Lang, id: string): string {
  return t(lang, `prod.${id}.label`);
}
export function productDesc(lang: Lang, id: string): string {
  return t(lang, `prod.${id}.desc`);
}

/** Область глаз («Ресницы», «стрелки и тушь»). */
export function areaLabel(lang: Lang, id: string): string {
  return t(lang, `area.${id}.label`);
}
export function areaDesc(lang: Lang, id: string): string {
  return t(lang, `area.${id}.desc`);
}

/** Вариант области (стрелки/брови/веки): opt.<area>.<option> из словаря,
 *  при отсутствии ключа — английский, затем русский. */
export function optionLabel(lang: Lang, areaId: string, optionId: string): string {
  return t(lang, `opt.${areaId}.${optionId}`);
}

/** Название оттенка: RU — русское из данных, остальные — английское (данные же). */
export function swatchName(lang: Lang, swatch: { name: string; en: string }): string {
  return lang === "ru" ? swatch.name : swatch.en;
}

/** Финиш нанесения по id данных (matte/satin/gloss/shimmer). */
export function finishLabel(lang: Lang, id: string): string {
  return t(lang, `finish.${id}`);
}

/** Плотность: 1/2/3. */
export function intensityLabel(lang: Lang, n: 1 | 2 | 3): string {
  return t(lang, `intensity.${n}`);
}

/** Кисть/спонж по id данных (fluffy/flat/sponge/pencil/fan/spoolie). */
export function brushLabel(lang: Lang, id: string): string {
  return t(lang, `tool.${id}.label`);
}
export function brushHint(lang: Lang, id: string): string {
  return t(lang, `tool.${id}.hint`);
}

/** Подпись группы вариантов области. */
export function optionGroupLabel(lang: Lang, areaId: string): string {
  if (areaId === "lashes") return t(lang, "ctor.lashesOpt");
  if (areaId === "brows") return t(lang, "ctor.browsOpt");
  return t(lang, "ctor.lidsOpt");
}

/** Заголовок панели «Инструменты». */
export function toolsTitle(lang: Lang): string {
  return t(lang, "ctor.toolsTitle");
}

/** «Свой оттенок» — подпись пипетки в палитре. */
export function customShadeLabel(lang: Lang): string {
  return t(lang, "ctor.customShade");
}

/** Aria-подпись переключателя продукта/области: «Включить: Помада». */
export function enableAria(lang: Lang, name: string): string {
  return t(lang, "ctor.enableAria", { name });
}

// ---------- Серверные тексты (без React) ----------

/** Язык пользователя из БД (glam_users.language_code) → Lang. */
export function langFromCode(code: string | null | undefined): Lang {
  return isLang(code ?? "") ? (code as Lang) : "ru";
}

/** Текст благодарности после успешной оплаты Звёздами. */
export function thanksText(
  lang: Lang,
  vars: { name: string; pack: string; n: number; rest: number }
): string {
  return t(lang, "srv.thanks", vars);
}

/** Текст напоминания замершему. n === 1 → единственная форма. */
export function remindText(lang: Lang, vars: { name: string; n: number }): string {
  return t(lang, vars.n === 1 ? "srv.remind1" : "srv.remindN", vars);
}
