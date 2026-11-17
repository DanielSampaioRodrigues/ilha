// Pedaços do microfone (já com cancelamento de eco), mandados para a página.
class Captura extends AudioWorkletProcessor {
  process(entradas) {
    const canal = entradas[0] && entradas[0][0];
    if (canal) this.port.postMessage(canal.slice(0));
    return true;
  }
}
registerProcessor("captura", Captura);
