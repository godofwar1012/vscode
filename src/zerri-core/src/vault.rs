use keyring::Entry;

pub struct SecureVault;

impl SecureVault {
    const SERVICE_NAME: &'static str = "zerri-code";

    pub fn set_secret(key_name: &str, secret_value: &str) -> Result<(), String> {
        let entry = Entry::new(Self::SERVICE_NAME, key_name)
            .map_err(|e| format!("Erreur création entrée coffre: {}", e))?;
        entry
            .set_password(secret_value)
            .map_err(|e| format!("Erreur écriture coffre sécurisé: {}", e))
    }

    pub fn get_secret(key_name: &str) -> Result<String, String> {
        let entry = Entry::new(Self::SERVICE_NAME, key_name)
            .map_err(|e| format!("Erreur accès entrée coffre: {}", e))?;
        entry
            .get_password()
            .map_err(|e| format!("Secret introuvable ou inaccessible: {}", e))
    }

    pub fn delete_secret(key_name: &str) -> Result<(), String> {
        let entry = Entry::new(Self::SERVICE_NAME, key_name)
            .map_err(|e| format!("Erreur accès entrée coffre: {}", e))?;
        entry
            .delete_password()
            .map_err(|e| format!("Erreur suppression coffre: {}", e))
    }
}
