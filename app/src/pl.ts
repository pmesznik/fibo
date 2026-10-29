/** Odmiana rzeczownika po liczebniku: 1 zdjęcie, 2 zdjęcia, 5 zdjęć (a także 22 zdjęcia, 12 zdjęć, 25 zdjęć). */
export const pl = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many
