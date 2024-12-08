
const express = require('express');
const https = require('https');
const bodyParser = require('body-parser');
const { SerialPort } = require('serialport');

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

const port = new SerialPort({
    path: 'COM4', // Replace with the correct COM port
    baudRate: 9600
});

let buffer = ''; 
let lastCommand = null;
let moisture = null;
let motorOnTime = null;
let temperature = null;
const weatherConditions = []; 
const FIVE_HOURS = 5 * 60 * 60 * 1000; 
const TWO_HOURS = 2 * 60 * 60 * 1000;
const ONE_HOUR = 1 * 60 * 60 * 1000; 

let outputMessage = "System status is currently unavailable."; // Default message

// Serial port data listener
port.on('open', () => {
    console.log('Serial Port Opened');
    port.on('data', (data) => {
        buffer += data.toString();

        if (buffer.includes('\n')) {
            const receivedData = buffer.trim();
            buffer = ''; 

            const parsedMoisture = parseInt(receivedData.match(/\d+/)?.[0], 10); 
            if (!isNaN(parsedMoisture)) {
                moisture = parsedMoisture; 
                console.log(`Moisture level: ${moisture}`);
                processMotorCommand();
            } else {
                console.error(`Received moisture data: '${receivedData}'. Ignoring.`);
            }
        }
    });
});

port.on('error', (err) => {
    console.error('Error opening serial port:', err.message);
});

app.listen(8082, () => {
    console.log("Server is running on port 8082...");
});

// Serve index.html on root route
app.get('/', (req, res) => {
    res.sendFile(__dirname + "/index.html");
});

// Display the output message on /status route
app.get('/status', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>System Status</title>
                <meta http-equiv="refresh" content="5"> <!-- Refresh every 5 seconds -->
                <style>
                    body { font-family: Arial, sans-serif; text-align: center; margin-top: 50px; }
                    h2 { color: #333; }
                    p { font-size: 1.2em; color: #555; }
                    .status-container { padding: 20px; border: 1px solid #ddd; border-radius: 5px; width: 50%; margin: auto; }
                </style>
            </head>
            <body>
                <div class="status-container">
                    <h2>Current System Status</h2>
                    <p>${outputMessage}</p>
                </div>
            </body>
        </html>
    `);
});

// Weather data route
app.post('/', (req, res) => {
    const query = req.body.cityName;
    const apikey = 'd1845658f92b31c64bd94f06f7188c9c';
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${query}&appid=${apikey}&units=metric`;

    https.get(url, (response) => {
        let data = '';
        response.setEncoding('utf8');

        response.on('data', (chunk) => {
            data += chunk; 
        });

        response.on('end', () => {
            try {
                const weatherData = JSON.parse(data);
                temperature = weatherData.main.temp;
                weatherConditions.length = 0; 
                weatherConditions.push(...weatherData.weather.map(condition => condition.main.toLowerCase()));

                const responseMessage = `<h1>Weather in ${weatherData.name}:</h1>
                                         <p>Temperature: ${temperature}°C</p>
                                         <p>Conditions: ${weatherConditions.join(', ')}</p>`;

                res.write(responseMessage);
                res.end();

                processMotorCommand();

            } catch (error) {
                console.error("Error parsing weather data:", error);
                res.write("<h1>Error parsing weather data.</h1>");
                res.end();
            }
        });
    }).on('error', (e) => {
        console.error(e);
        res.write("<h1>Error fetching weather data.</h1>");
        res.end();
    });
});

function processMotorCommand() {
    if (moisture !== null) {
        const currentTime = Date.now();
        let motorCommand = 'MOTOR_OFF';

        if (weatherConditions.length > 0) {
            if (weatherConditions.includes("rain")) {
                motorOnTime = null;
                outputMessage = `Weather is rainy. Motor OFF due to natural watering.`;
            } else if (weatherConditions.includes("clear sky") || moisture > 950) {
                motorCommand = 'MOTOR_ON';
                motorOnTime = motorOnTime || currentTime;
                setTimeout(() => motorCommand = 'MOTOR_OFF', FIVE_HOURS);
                outputMessage = `Weather clear, moisture ${moisture}. Motor ON for 5 hours.`;
            } else if (weatherConditions.includes("clear") || moisture > 600 && moisture <= 950) {
                motorCommand = 'MOTOR_ON';
                motorOnTime = motorOnTime || currentTime;
                setTimeout(() => motorCommand = 'MOTOR_OFF', FIVE_HOURS);
                outputMessage = `Weather clear, moisture ${moisture}. Motor ON for 5 hours.`;
            }
            else if (weatherConditions.includes("haze") && moisture > 450 && moisture <= 950) {
                motorCommand = 'MOTOR_ON';
                motorOnTime = motorOnTime || currentTime;
                setTimeout(() => motorCommand = 'MOTOR_OFF', TWO_HOURS);
                outputMessage = `Weather hazy, moisture ${moisture}. Motor ON for 2 hours.`;
            } else if (weatherConditions.includes("clouds") && moisture > 300 && moisture <= 450) {
                motorCommand = 'MOTOR_ON';
                motorOnTime = motorOnTime || currentTime;
                setTimeout(() => motorCommand = 'MOTOR_OFF', ONE_HOUR);
                outputMessage = `Weather cloudy, moisture ${moisture}. Motor ON for 1 hour.`;
            } else if (weatherConditions.includes("smoke") && moisture > 200 && moisture <= 250) {
                motorCommand = 'MOTOR_ON';
                motorOnTime = motorOnTime || currentTime;
                setTimeout(() => motorCommand = 'MOTOR_OFF', ONE_HOUR);
                outputMessage = `Weather smoky, moisture ${moisture}. Motor ON for 1 hour.`;
            } else {
                motorOnTime = null;
                outputMessage = `Weather: ${weatherConditions.join(', ')}, moisture ${moisture}. Motor OFF.`;
            }
        } else {
            if (moisture > 950) {
                motorCommand = 'MOTOR_ON';
                motorOnTime = motorOnTime || currentTime;
                setTimeout(() => motorCommand = 'MOTOR_OFF', FIVE_HOURS);
                outputMessage = `No weather data, high moisture ${moisture}. Motor ON for 5 hours.`;
            } else if (moisture > 450 && moisture <= 950) {
                motorCommand = 'MOTOR_ON';
                motorOnTime = motorOnTime || currentTime;
                setTimeout(() => motorCommand = 'MOTOR_OFF', TWO_HOURS);
                outputMessage = `No weather data, moderate moisture ${moisture}. Motor ON for 2 hours.`;
            } else {
                motorOnTime = null;
                outputMessage = `No weather data, low moisture ${moisture}. Motor OFF.`;
            }
        }

        if (motorCommand !== lastCommand) {
            port.write(`${motorCommand}\n`, (err) => {
                if (err) {
                    console.error('Error writing to serial port:', err.message);
                } else {
                    console.log(`Motor command sent: ${motorCommand}`);
                    console.log(outputMessage);
                }
            });
            lastCommand = motorCommand;
        }
    } else {
        console.log("Waiting for valid moisture data...");
    }
}
