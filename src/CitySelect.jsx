// [本 fork 新增] 天氣那一行開頭的城市名:看起來是字,點了是選單(手機上叫出系統的滾輪)。
import { useEffect, useState } from "react";
import { CITIES, readCity, saveCity } from "./city.js";

/** 目前選的城市;任何一處換了,全部跟著換。 */
export function useCity() {
  const [city, setCity] = useState(readCity);
  useEffect(() => {
    const onChange = () => setCity(readCity());
    window.addEventListener("wardrobe-city-change", onChange);
    return () => window.removeEventListener("wardrobe-city-change", onChange);
  }, []);
  return city;
}

/* 天氣資料的出處(2026-10-26 授權盤點):Open-Meteo 的資料是 CC BY 4.0,顯示天氣的地方旁邊要寫來源、連過去。
   放在天氣那一行的最後,字跟那行一樣小 */
export function WeatherCredit() {
  return <><span aria-hidden="true">· </span><a className="weather-credit" href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" title="天氣資料:Open-Meteo(CC BY 4.0)">Open-Meteo</a></>;
}

export function CitySelect() {
  const city = useCity();
  return (
    <span className="city-select">
      <select aria-label="天氣看哪個城市" value={city.key} onChange={(event) => saveCity(event.target.value)}>
        {CITIES.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
      </select>
      <span className="city-select-label" aria-hidden="true">{city.label}</span>
    </span>
  );
}
