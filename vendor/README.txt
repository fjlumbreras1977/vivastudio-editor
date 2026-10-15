Codificadores incluidos para exportación local, sin llamadas a servidores.
libflacjs 5.6.0: https://github.com/mmig/libflac.js (MIT; libFLAC/Xiph).
wasm-media-encoders 0.7.0: https://github.com/arseneyr/wasm-media-encoders (MIT; libogg/libvorbis/Xiph).
Los archivos de biblioteca se conservan sin cambios en esta carpeta. El generador
inserta los binarios WASM y adapta una inicialización Module de libflacjs para
proporcionar wasmBinary en memoria. La adaptación evita descargas adicionales.
Los avisos y licencias se incluyen también en el HTML autónomo.
