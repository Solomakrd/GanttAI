export const ru = {
  documentTitle: 'GanttAI | Рабочее пространство планирования',
  documentDescription: 'Рабочее пространство для планирования диаграмм Ганта с ИИ',
  language: 'Язык', english: 'Английский', russian: 'Русский',
  home: 'Главная GanttAI', activeProject: 'Активный проект', project: ({ number }) => `Проект ${number}`,
  undo: 'Отменить', newProject: 'Новый проект', importedWorkspace: 'Импортированное пространство', savedWorkspace: 'Сохранённое пространство',
  workspaceSurfaces: 'Разделы рабочего пространства', plan: 'План', aiAssistant: 'ИИ-ассистент', planningWorkspace: 'Рабочее пространство',
  taskVersion: ({ count, version }) => `${count} ${plural(count, 'задача', 'задачи', 'задач')} · версия ${version}`,
  importSaved: 'Импорт сохранён', workspaceSaved: 'Пространство сохранено', loadingPlan: 'Загружаем план...',
  loadFailed: 'Не удалось загрузить план.', loadFailedHelp: 'Проверьте, что API и база данных запущены, затем повторите попытку.', retry: 'Повторить',
  operationFailed: 'Не удалось выполнить операцию. Повторите попытку.',
  preparingAssistant: 'Готовим ассистента...', staleChat: 'Уже активен более новый план. Устаревший результат чата отклонён; обновите страницу перед повтором.',
  staleTask: 'Уже активен более новый план. Результат изменения задачи отклонён; обновите страницу перед повтором.',
  rejectedTasks: ({ count, ids }) => `${count} ${plural(count, 'некорректная запись задачи исключена', 'некорректные записи задач исключены', 'некорректных записей задач исключено')} (${ids}).`,
  planAssistantBoundary: 'Граница плана и ИИ-ассистента', interactiveChart: 'Интерактивная диаграмма Ганта', noTasks: 'В плане нет задач',
  noTasksHelp: 'Попросите ИИ-ассистента или импортируйте книгу Excel, чтобы заполнить шкалу времени.', timeline: 'Шкала времени', deliveryPlan: 'План работ',
  zoomOut: 'Уменьшить масштаб', zoomIn: 'Увеличить масштаб', fitPlan: 'Показать весь план', task: 'Задача', ownerLength: 'Исполнитель / срок',
  editDetails: ({ task }) => `Изменить задачу «${task}»`, editBar: ({ task }) => `Изменить срок задачи «${task}»`,
  durationShort: ({ count }) => `${count} ${plural(count, 'день', 'дня', 'дней')}`, taskOwnerBoundary: 'Граница задачи и исполнителя', taskTimelineBoundary: 'Граница таблицы задач и шкалы времени',
  taskDependencies: 'Зависимости задач', assignedTo: ({ task, assignee }) => `${task}, исполнитель: ${assignee}`,
  taskDuration: 'Длительность задачи', predecessor: 'Предшественник', resizeHelp: 'Перетащите или используйте стрелки для изменения размера. Двойной щелчок, Enter или пробел сбрасывают размер.',
  planAssistant: 'Ассистент планирования', editsPlan: 'Помогает редактировать план', connecting: 'подключение', connected: 'подключено', disconnected: 'отключено',
  chatDisconnected: 'Чат отключён. Подключитесь снова и повторите попытку.', chatInvalid: 'Чат вернул некорректный ответ. Текущий план оставлен без изменений.', startingRequest: 'Запускаем запрос...', you: 'Вы',
  chatEmpty: 'Попросите о массовых изменениях: перенести этап, назначить работу другому исполнителю или изменить зависимости.', cancel: 'Отмена',
  requestChange: 'Запрос на изменение плана', requestPlaceholder: 'Перенеси тестирование после подготовки запуска и назначь его Майе',
  newVersionHint: 'Изменения создают новую версию плана', sendRequest: 'Отправить запрос',
  excelExchange: 'Обмен с Excel', import: 'Импорт', exportExcel: 'Экспорт в Excel', exporting: 'Экспорт…', importData: 'Импорт данных',
  loadExcel: 'Загрузить план из Excel', closeImport: 'Закрыть окно импорта', importIntro: 'Выберите первый лист книги Excel. План изменится только после успешной проверки файла.',
  chooseWorkbook: 'Выберите книгу .xlsx', workbookLimit: 'Книга Excel · до 2 МиБ', importWorkbook: 'Импорт книги (.xlsx)',
  invalidWorkbook: 'Выберите книгу .xlsx размером не более 2 МиБ.',
  expectedColumns: 'Ожидаемые столбцы: задача, описание, исполнитель, длительность, предшественники. Импорт создаёт сохранённую версию плана только после проверки.',
  selected: 'Выбран файл:', projectStart: 'Дата начала проекта', dateHelp: 'Выберите дату для задач без дат. Учитываются все календарные дни, включая выходные и праздники. Указанные значения start_date и end_date проверяются и сохраняются, а не пересчитываются по этой дате.',
  clear: 'Очистить', importPlan: 'Импортировать план', importing: 'Импорт…', validatingWorkbook: 'Проверяем книгу…', preparingWorkbook: 'Готовим книгу…',
  importedTasks: ({ count }) => `Импортировано ${count} ${plural(count, 'задача', 'задачи', 'задач')}. Проект сохранён и будет доступен после перезагрузки.`,
  downloadStarted: 'Загрузка книги началась.', workbookFailed: 'Не удалось выполнить операцию с книгой. Повторите попытку.',
  apiUnavailable: 'Не удалось подключиться к API планирования. Проверьте соединение и работу API, затем повторите попытку.',
  apiStatus: ({ status }) => `API планирования вернул код ${status}. Повторите попытку.`,
  apiValidationDetail: ({ sheet, row, column, message }) => {
    const location = [sheet && `Лист «${sheet}»`, row && `строка ${row}`, column && `столбец ${column}`].filter(Boolean).join(', ')
    return `${location ? `${location}: ` : ''}${message}`
  },
  invalidPlan: 'API вернул некорректный план. Текущий план сохранён; перезагрузите страницу или повторите попытку.',
  invalidImportedPlan: 'API вернул некорректный план. Текущий план сохранён; исправьте книгу или повторите попытку.',
  invalidProject: 'API вернул некорректный снимок проекта.', invalidWorkspace: 'API вернул некорректное рабочее пространство.',
  taskNameRequired: 'Укажите название задачи.', assigneeRequired: 'Укажите исполнителя.', durationInvalid: 'Длительность должна быть целым числом от 1 до 730.',
  startDateInvalid: 'Выберите корректную дату начала.', taskSaveFailed: 'Не удалось сохранить задачу. Текущий план оставлен без изменений.', taskDetails: 'Сведения о задаче',
  editTask: 'Изменить задачу', closeTask: 'Закрыть сведения о задаче', taskHelp: 'Измените задачу и сохраните все правки как одну новую версию плана.', taskName: 'Название задачи',
  assignee: 'Исполнитель', durationDays: 'Длительность (дни)', startDate: 'Дата начала', endDate: 'Дата окончания', description: 'Описание', predecessors: 'Предшественники',
  noOtherTasks: 'Других задач нет.', saving: 'Сохранение...', saveChanges: 'Сохранить изменения',
}

function plural(count, one, few, many) {
  const mod10 = Math.abs(count) % 10
  const mod100 = Math.abs(count) % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}
