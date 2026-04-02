const axios = require('axios');
require('dotenv').config();

async function getWeather(city = 'Toronto') {
  try {
    const response = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
      params: {
        q: `${city},CA`,
        appid: process.env.OPENWEATHER_API_KEY,
        units: 'metric'
      }
    });
    const data = response.data;
    return {
      condition: data.weather[0].main,
      description: data.weather[0].description,
      temp: Math.round(data.main.temp * 10) / 10,
      feelsLike: Math.round(data.main.feels_like * 10) / 10,
      humidity: data.main.humidity
    };
  } catch (err) {
    console.error('Weather fetch failed:', err.message);
    return { condition: 'Clear', temp: 10, description: 'Unknown', feelsLike: 10, humidity: 50 };
  }
}

module.exports = { getWeather };
