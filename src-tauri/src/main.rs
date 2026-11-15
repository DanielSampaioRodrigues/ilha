// Esconde a janela preta de terminal no Windows na versão instalada.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ilha_lib::run()
}
