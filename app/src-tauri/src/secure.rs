//! Szyfrowanie danych twarzy kluczem konta Windows (DPAPI). Odszyfrować może je tylko ten sam użytkownik Windows
//! na tym samym komputerze, więc skopiowana baza FIBO nie ujawnia wektorów twarzy.
//! To jedyne miejsce w programie z blokiem `unsafe` (wywołania systemu Windows).

#[cfg(windows)]
mod imp {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};

    const ENTROPY: &[u8] = b"FIBO-faces-v1";

    fn blob(b: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB { cbData: b.len() as u32, pbData: b.as_ptr() as *mut u8 }
    }

    fn run(data: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
        let input = blob(data);
        let entropy = blob(ENTROPY);
        let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        // SAFETY: wskaźniki wskazują na żywe bufory na czas wywołania; wynik kopiujemy i zwalniamy LocalFree.
        unsafe {
            let ok = if encrypt {
                CryptProtectData(&input, std::ptr::null(), &entropy, std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
            } else {
                CryptUnprotectData(&input, std::ptr::null_mut(), &entropy, std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
            };
            if ok == 0 || out.pbData.is_null() {
                return Err("Windows nie pozwolił zaszyfrować lub odszyfrować danych twarzy".into());
            }
            let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
            LocalFree(out.pbData as *mut core::ffi::c_void);
            Ok(v)
        }
    }

    pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> { run(data, true) }
    pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> { run(data, false) }
}

#[cfg(not(windows))]
mod imp {
    pub fn protect(_: &[u8]) -> Result<Vec<u8>, String> { Err("szyfrowanie danych twarzy działa tylko w Windows".into()) }
    pub fn unprotect(_: &[u8]) -> Result<Vec<u8>, String> { Err("szyfrowanie danych twarzy działa tylko w Windows".into()) }
}

pub use imp::{protect, unprotect};

/// Wektor twarzy (liczby f32) jako zaszyfrowane bajty.
pub fn seal_embedding(v: &[f32]) -> Result<Vec<u8>, String> {
    let mut raw = Vec::with_capacity(v.len() * 4);
    for x in v { raw.extend_from_slice(&x.to_le_bytes()); }
    protect(&raw)
}

pub fn open_embedding(b: &[u8]) -> Result<Vec<f32>, String> {
    let raw = unprotect(b)?;
    if raw.len() % 4 != 0 { return Err("uszkodzony wektor twarzy".into()); }
    Ok(raw.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn embedding_roundtrip_and_not_plaintext() {
        let v: Vec<f32> = (0..128).map(|i| i as f32 / 7.0).collect();
        let sealed = seal_embedding(&v).unwrap();
        let raw: Vec<u8> = v.iter().flat_map(|x| x.to_le_bytes()).collect();
        assert_ne!(sealed, raw);
        assert!(!sealed.windows(16).any(|w| raw.windows(16).any(|r| r == w)), "w zaszyfrowanych danych nie ma jawnych fragmentów");
        assert_eq!(open_embedding(&sealed).unwrap(), v);
        let mut bad = sealed.clone();
        let last = bad.len() - 1;
        bad[last] ^= 0xff;
        assert!(open_embedding(&bad).is_err(), "zmieniony bajt musi być wykryty");
    }
}
