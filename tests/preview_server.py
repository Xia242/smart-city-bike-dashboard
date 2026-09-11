"""Local UI test bridge: real simulator, in-process MQTT transport substitute.
Run from any directory with the project's paho-mqtt dependency installed.
"""
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import json
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from City_Simulator import CitySimulator
ROOT = Path(__file__).resolve().parents[1]
sim = CitySimulator(str(ROOT / 'config.json'))
BRIDGE = '''<script>
class TestMessage { constructor(payload){this.payloadString=payload;} }
class TestClient {
 connect(options){this.connected=true;setTimeout(options.onSuccess,0);}
 isConnected(){return this.connected;}
 subscribe(topic){
  if(topic.includes('/reply/')) return;
  const update=()=>fetch('/snapshot').then(r=>r.json()).then(p=>this.onMessageArrived({destinationName:topic,payloadString:JSON.stringify(p)}));
  update();setInterval(update,1000);
 }
 send(message){fetch('/command',{method:'POST',body:message.payloadString}).then(r=>r.json()).then(p=>this.onMessageArrived({destinationName:TOPIC+'/reply/'+CLIENT_ID,payloadString:JSON.stringify(p)}));}
}
const Paho={Client:TestClient,Message:TestMessage};
</script>'''
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(ROOT),**kwargs)
    def json(self, payload):
        data=json.dumps(payload).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(data)
    def do_GET(self):
        if self.path == '/snapshot': return self.json(sim.snapshot(True))
        if self.path in ('/', '/index.html'):
            html=(ROOT/'index.html').read_text().replace('<script src="https://cdnjs.cloudflare.com/ajax/libs/paho-mqtt/1.1.0/paho-mqtt.min.js"></script>',BRIDGE)
            html=html.replace('<script src="app.js"></script>', '<script>document.addEventListener("DOMContentLoaded",()=>{initTheme();connectMQTT();});</script>')
            self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.end_headers();self.wfile.write(html.encode());return
        super().do_GET()
    def do_POST(self):
        if self.path != '/command': self.send_error(404);return
        length=int(self.headers.get('Content-Length','0'))
        if length>4096: self.send_error(413);return
        self.json(sim.process_command(json.loads(self.rfile.read(length))))
if __name__ == '__main__': HTTPServer(('127.0.0.1',8765),Handler).serve_forever()
