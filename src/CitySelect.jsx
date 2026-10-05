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
