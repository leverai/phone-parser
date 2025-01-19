const axios = require('axios');
const cheerio = require('cheerio');
var xlsx = require('node-xlsx');
const { parse } = require('node-html-parser');
const sqlite3 = require('sqlite3').verbose();
const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const events = require('events');
const mysql = require('mysql2/promise');
events.defaultMaxListeners = 20;
process.setMaxListeners(20);

const proxyList = [
    '78.29.38.132:65056',
    '92.255.169.26:65056',
    '85.95.152.57:65056',
    '87.225.109.74:65056',
    '95.172.54.178:65056',
    '46.46.32.137:65056',
    '37.235.154.129:65056'
];
let currentIndex = 0;
function getRandomProxy() {
    // const randomIndex = Math.floor(Math.random() * proxyList.length);
    // return proxyList[randomIndex];
    const proxy = proxyList[currentIndex];
    currentIndex = (currentIndex + 1) % proxyList.length;
    return proxy;
}

async function createDriver() {
    const proxy = getRandomProxy();
    console.log(`Используется прокси: ${proxy}`);

    const options = new chrome.Options();
    options.addArguments('user-agent=asdasds');
    options.addArguments('--headless');
    options.addArguments('--disable-gpu');
    options.addArguments(`--proxy-server=${proxy}`);
    options.addArguments('--ignore-certificate-errors');

    const driver = await new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options)
        .build();

    return driver;
}


// Database
const dbConfig = {
    host: '185.105.117.115',
    user: 'root1234',
    password: 'root1234',
    database: 'adblock_list',
};

async function initDatabase() {
    try {
        const connection = await mysql.createConnection(dbConfig);

        // Создание таблицы, если её ещё нет
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS phone_data (
                id INT AUTO_INCREMENT PRIMARY KEY,
                phone_number VARCHAR(20),
                company_name VARCHAR(255),
                region VARCHAR(255),
                category VARCHAR(255),
                operator VARCHAR(255),
                operator_code VARCHAR(10),
                phone_info TEXT
            )
        `);

        console.log('Таблица phone_data успешно создана.');
        await connection.end();
    } catch (error) {
        console.error('Ошибка инициализации базы данных:', error.message);
    }
}

// Функция для сохранения данных в базу
async function saveToDatabase(data) {
    try {
        const connection = await mysql.createConnection(dbConfig);

        const query = `
            INSERT INTO phone_data (phone_number, company_name, region, category, operator, operator_code, phone_info)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                company_name = VALUES(company_name),
                region = VALUES(region),
                category = VALUES(category),
                operator = VALUES(operator),
                operator_code = VALUES(operator_code),
                phone_info = VALUES(phone_info)
        `;

        const values = [
            data.phoneNumber || null,
            data.companyName || null,
            data.region || null,
            data.category || null,
            data.operator || null,
            data.operatorCode || null,
            data.phoneInfo || null,
        ];

        const [result] = await connection.execute(query, values);
        console.log(`Данные для номера ${data.phoneNumber} успешно записаны в базу с ID ${result.insertId || 'существующий ID'}.`);

        await connection.end();
    } catch (error) {
        console.error(`Ошибка записи данных для номера ${data.phoneNumber}:`, error.message);
    }
}

initDatabase();

//

async function getElementText(driver, selector, replaceText = '') {
    try {
        const element = await driver.findElement(By.css(selector));
        const text = await element.getText();
        return replaceText ? text.replace(replaceText, '').trim() : text.trim();
    } catch (error) {
        console.log(`Элемент ${selector} не найден. Устанавливается значение null.`);
        return null;
    }
}
async function getPhoneNumbers() {
    const query = `
        SELECT id, phone_number FROM phone_data`;

    try {
        const connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute(query);
        await connection.end();

        return rows; // Вернёт массив объектов с полями `id` и `phone_number`
    } catch (err) {
        console.error('Ошибка при получении номеров из базы:', err.message);
        throw err;
    }
}

async function fetchPhoneData(phoneNumber, driver, maxRetries = 5,) {
    let attempt = 0;
    if (phoneNumber.length == 11) phoneNumber = phoneNumber.slice(1)
    while (attempt < maxRetries) {
        console.log(`Попытка #${attempt + 1} для номера ${phoneNumber}.`);
        try {
            console.log(`Обработка номера ${phoneNumber}`);
            await driver.get(`https://www.tbank.ru/oleg/who-called/info/7${phoneNumber}/`);

            try {
                const element = await driver.wait(
                    until.elementLocated(
                        By.css('.bbAHvcWax, [data-qa-type="mvno/numberNotFound_InfoHeader"]')
                    ),
                    20000
                );

                const elementClass = await element.getAttribute('class');
                if (elementClass && elementClass.includes('bbAHvcWax')) {
                    console.log(`Данные найдены для номера ${phoneNumber}`);
                    const parsedData = {
                        phoneNumber: phoneNumber,
                        companyName: await getElementText(driver, '.bbAHvcWax .eb5-\\+42tmj li:nth-child(3) span', 'Название компании:'),
                        region: await getElementText(driver, '.bbAHvcWax .eb5-\\+42tmj li:nth-child(1) span', 'Регион:'),
                        category: await getElementText(driver, '.bbAHvcWax .eb5-\\+42tmj li:nth-child(2) span .ib5-\\+42tmj'),
                        operator: await getElementText(driver, '.bbAHvcWax .eb5-\\+42tmj li:nth-child(4) span', 'Оператор:'),
                        operatorCode: await getElementText(driver, '.bbAHvcWax .eb5-\\+42tmj li:nth-child(5) span a'),
                        phoneInfo: await getElementText(driver, '.bbAHvcWax .ab5-\\+42tmj div'),
                    };
                    console.log(parsedData)
                    await saveToDatabase(parsedData);
                } else {
                    console.log(`Данные для номера ${phoneNumber} не найдены.`);
                    const nullData = {
                        phoneNumber: phoneNumber,
                        companyName: null,
                        region: null,
                        category: null,
                        operator: null,
                        operatorCode: null,
                        phoneInfo: null,
                    };
                    await saveToDatabase(nullData);
                }
                return;
            } catch (error) {
                console.error(`Ошибка при обработке номера ${phoneNumber}:`, error.message);
                attempt++;
            }

        } catch (error) {
            if (error.response && error.response.status === 404) {
                console.log(`Данные для номера ${phoneNumber} не найдены (404).`);
                const data = {
                    phoneNumber: phoneNumber,
                    companyName: null,
                    region: null,
                    category: null,
                    operator: null,
                    operatorCode: null,
                    phoneInfo: null,
                };
                await saveToDatabase(data);
            } else {
                console.error(`Ошибка при обработке номера ${phoneNumber}:`, error.message);
            }
            attempt++;
        }
    }
};



async function processPhoneNumbersConcurrently(maxParallel = 10, delay = 1000) {
    const rows = Phones;
    if (rows.length === 0) {
        console.log('Нет номеров для обработки.');
        return;
    }
    const db_rows = await getPhoneNumbers();
    const dbPhoneNumbers = new Set(db_rows.map(db_row => db_row.phone_number))

    const uniquePhones = rows.filter(phone => !dbPhoneNumbers.has(phone));

    if (uniquePhones.length === 0) {
        console.log('Все номера из массива уже есть в базе данных.');
        return;
    }

    console.log(uniquePhones);
    console.log(`Всего номеров для обработки: ${uniquePhones.length}`);
    const queue = [...uniquePhones];
    const activeTasks = new Set();



    async function processNext() {
        if (queue.length === 0 && activeTasks.size === 0) {
            console.log('Обработка всех номеров завершена.');
            // db.close();
            return;
        }

        while (queue.length > 0 && activeTasks.size < maxParallel) {
            const phone_number = queue.shift();
            console.log(`Начата обработка номера ${phone_number}`);

            const task = (async () => {
                const driver = await createDriver();
                try {
                    await fetchPhoneData(phone_number, driver);
                } catch (error) {
                    console.error(`Ошибка при обработке номера ${phone_number}: ${error.message}`);
                } finally {
                    await driver.quit();
                }

                await new Promise(resolve => setTimeout(resolve, delay));
            })();

            activeTasks.add(task);


            task.finally(() => {
                activeTasks.delete(task);
                processNext();
            });
        }
    }

    processNext();

    await Promise.all([...activeTasks]);
}

var obj = xlsx.parse(__dirname + '/adblock_list.xls');
var Phones;
obj.forEach(sheet => {
    var c = 0
    sheet.data.forEach(row => {
        c++;
        if (c == 12) {
            var parsedRow = parse(row);
            var i = 0
            var rows = parsedRow.querySelectorAll("tr").slice(1)
            Phones = rows
                .map(row => row.querySelectorAll('td')[7])
                .filter(cell => cell !== undefined)
                .map(cell => {
                    let phone = cell.text.trim();
                    if (phone.length === 11) {
                        phone = phone.slice(1);
                    }
                    return phone;
                });
            // console.log(Phones)
            // console.log(Phones.length)
        }

    });
});

processPhoneNumbersConcurrently(10, 1000).then(() => {
    console.log('Скрипт завершен.');
});