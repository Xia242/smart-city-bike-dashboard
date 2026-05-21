"""
Copyright (c) 2026 Wei-Chieh Hsia. All rights reserved.
"""
import math
import time
import json
import random
import sys
from collections import deque
from datetime import datetime, timedelta

import paho.mqtt.client as mqtt


# ==========================================
# Terminal Colors
# ==========================================
class Colors:
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'


# ==========================================
# Tunables for the lightweight forecast
# ==========================================
HISTORY_BUCKET_MINUTES = 5     # one history sample every 5 minutes
HISTORY_WINDOW_MIN = 180       # keep 3 hours of history
FORECAST_HORIZON_MIN = 60      # forecast 1 hour ahead
FORECAST_STEP_MIN = 5          # forecast samples spaced 5 min apart
NET_FLOW_WINDOW_MIN = 15       # net-flow averaged over last 15 minutes


# ==========================================
# Data Models
# ==========================================
class Bike:
    def __init__(self, bike_id: str):
        self.bike_id = bike_id
        self.status = "AVAILABLE"

    def to_dict(self):
        return {"bike_id": self.bike_id, "status": self.status}


class Station:
    """
    A station tracks not just its current bikes but also a rolling history of
    bike-count snapshots and a rolling net-flow signal. The simulator pre-seeds
    the history at boot so the trend chart looks populated from second 0.
    """

    def __init__(self, parking_id: str, name: str, area: str,
                 distance: str, is_open: bool):
        self.parking_id = parking_id
        self.name = name
        self.area = area
        self.distance = distance
        self.is_open = is_open
        self.bikes = []

        # Rolling history: deque of (datetime, bike_count)
        # Capacity is set later once the seed is generated.
        self.history = deque()

        # Rolling net-flow events: deque of (datetime, delta)
        # delta = +1 when a bike arrives, -1 when one leaves.
        self.flow_events = deque()

        # Stabilises "vs. avg today" so the number doesn't re-roll every tick.
        self._cached_compare = None
        self._cached_compare_status = None

    # ---- bike movement ----
    def add_bike(self, bike: Bike):
        self.bikes.append(bike)
        self.flow_events.append((datetime.now(), +1))

    def remove_bike(self, bike: Bike):
        if bike in self.bikes:
            self.bikes.remove(bike)
            self.flow_events.append((datetime.now(), -1))

    # ---- pruning ----
    def prune_history(self, now: datetime):
        cutoff = now - timedelta(minutes=HISTORY_WINDOW_MIN)
        while self.history and self.history[0][0] < cutoff:
            self.history.popleft()

        flow_cutoff = now - timedelta(minutes=NET_FLOW_WINDOW_MIN)
        while self.flow_events and self.flow_events[0][0] < flow_cutoff:
            self.flow_events.popleft()

    def record_history_sample(self, now: datetime):
        """Append a (timestamp, current_bike_count) sample."""
        self.history.append((now, len(self.bikes)))
        self.prune_history(now)

    # ---- status ----
    def get_status_display(self):
        # Thresholds are calibrated for a baseline of ~25 bikes per station.
        # The black-hole cap in simulate_bikes() is 35, so OVERCROWDED has to
        # stay below 35 to ever trigger.
        count = len(self.bikes)
        if count <= 5:
            return "CRITICAL_EMPTY"
        elif count >= 32:
            return "CRITICAL_OVERCROWDED"
        else:
            return "NORMAL"

    def get_historical_compare(self, status_display: str):
        # Stable: only re-roll when status_display *changes*. Otherwise the
        # "vs. avg today" number would flicker every publish tick.
        if self._cached_compare_status == status_display and self._cached_compare is not None:
            return self._cached_compare
        if status_display == "CRITICAL_EMPTY":
            result = f"-{random.randint(10, 25)}%"
        elif status_display == "CRITICAL_OVERCROWDED":
            result = f"+{random.randint(15, 40)}%"
        else:
            v = random.randint(-8, 12)
            result = f"+{v}%" if v >= 0 else f"{v}%"
        self._cached_compare = result
        self._cached_compare_status = status_display
        return result

    # ---- net flow & forecast ----
    def compute_net_flow_per_min(self):
        """
        Bikes per minute over the rolling NET_FLOW_WINDOW_MIN window.
        Positive: net inflow. Negative: net outflow.

        Note: prune events older than the window *here* so the signal stays
        fresh regardless of when the next history-bucket sample runs (which
        is on a 5-minute cadence — too slow to keep this signal clean).
        """
        now = datetime.now()
        cutoff = now - timedelta(minutes=NET_FLOW_WINDOW_MIN)
        while self.flow_events and self.flow_events[0][0] < cutoff:
            self.flow_events.popleft()

        if not self.flow_events:
            return 0.0
        total = sum(d for _, d in self.flow_events)
        return total / max(1.0, NET_FLOW_WINDOW_MIN)

    def estimate_depletion_minutes(self):
        """
        How many minutes until the station hits 0 bikes given the current
        net-flow signal. Returns None if not draining or already empty.
        """
        net = self.compute_net_flow_per_min()
        count = len(self.bikes)
        if net >= -0.05 or count == 0:
            return None
        # net is negative; minutes to empty
        return max(1, int(round(count / abs(net))))

    def build_forecast(self, now: datetime, rush_hour: bool):
        """
        Lightweight forecast: start from the current count, walk forward in
        FORECAST_STEP_MIN steps applying the net-flow signal. Rush-hour gives
        the Main Gate a flow boost and other stations a small drain bias so
        the chart looks responsive to the active context.
        """
        net = self.compute_net_flow_per_min()
        rush_bias = 0.0
        if rush_hour:
            if "Main Gate" in self.name:
                rush_bias = +0.08   # bikes/min flowing in
            else:
                rush_bias = -0.05   # bikes/min flowing out
        effective = net + rush_bias

        forecast = []
        sim_count = float(len(self.bikes))
        for i in range(1, FORECAST_HORIZON_MIN // FORECAST_STEP_MIN + 1):
            ts = now + timedelta(minutes=i * FORECAST_STEP_MIN)
            sim_count += effective * FORECAST_STEP_MIN
            # Clamp to a sane visible range so the chart never explodes
            clamped = max(0.0, min(40.0, sim_count))
            forecast.append({
                "t": ts.strftime("%H:%M"),
                "count": round(clamped, 1),
            })
        return forecast

    def history_as_payload(self):
        return [
            {"t": ts.strftime("%H:%M"), "count": c}
            for ts, c in self.history
        ]

    def to_dict(self, context_tags: dict, now: datetime, rush_hour: bool):
        status_display = self.get_status_display()
        net_flow = self.compute_net_flow_per_min()
        depletion_min = self.estimate_depletion_minutes()

        return {
            "parking_id": self.parking_id,
            "name": self.name,
            "area": self.area,
            "mday": now.strftime("%Y%m%d"),
            "time": now.strftime("%H%M"),
            "status": self.is_open,
            "bikes": len(self.bikes),
            "status_display": status_display,
            "context_tags": context_tags,
            "historical_compare": self.get_historical_compare(status_display),
            "bike_ids": [b.to_dict() for b in sorted(self.bikes, key=lambda x: x.bike_id)],
            # NEW: lightweight forecast block
            "net_flow_per_min": round(net_flow, 3),
            "depletion_eta_min": depletion_min,
            "history": self.history_as_payload(),
            "forecast": self.build_forecast(now, rush_hour),
        }


# ==========================================
# Core Simulator
# ==========================================
class CitySimulator:
    def __init__(self, config_file: str):
        self.load_config(config_file)
        self.stations = {}
        self.total_bikes = 0
        self.setup_stations()
        self.seed_history()

        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        self.client.on_connect = self.on_connect
        self.client.on_disconnect = self.on_disconnect

        # Throttle: only append a real history sample once per bucket.
        self.last_history_sample = datetime.now()

    # ---- config ----
    def load_config(self, config_file: str):
        try:
            with open(config_file, 'r', encoding='utf-8') as f:
                self.config = json.load(f)
        except Exception as e:
            print(f"{Colors.FAIL}Failed to load config: {e}{Colors.ENDC}")
            sys.exit(1)

        self.broker = self.config.get("broker", "broker.hivemq.com")
        self.port = self.config.get("port", 8883)
        self.topic = self.config.get("topic", "smartcity/hanyang/bikeshare/state")
        self.demo_mode = self.config.get("demo_mode", "MORNING_RUSH")
        self.update_interval = self.config.get("update_interval", 3)

        self.context_tags = {
            "rush_hour": self.demo_mode == "MORNING_RUSH",
            "holiday": self.config.get("context", {}).get("holiday", False),
            "event": self.config.get("context", {}).get("event", "None"),
        }

    # ---- station setup ----
    def setup_stations(self):
        for idx, st_data in enumerate(self.config.get("stations", []), start=1):
            station = Station(
                parking_id=st_data["parking_id"],
                name=st_data["name"],
                area=st_data["area"],
                distance=st_data["distance"],
                is_open=st_data["is_open"]
            )
            initial_count = st_data.get("initial_bikes", 25)
            for n in range(1, initial_count + 1):
                bike_id = f"B-{idx}{n:03d}"
                # Bypass add_bike so initial seeding doesn't pollute the
                # net-flow signal with hundreds of phantom arrivals.
                station.bikes.append(Bike(bike_id))
                self.total_bikes += 1

            self.stations[station.name] = station

    def seed_history(self):
        """
        Pre-populate each station with HISTORY_WINDOW_MIN of synthetic past
        samples so the trend chart looks alive the moment the dashboard
        connects. Pattern: baseline + sine wave (daily cycle) + small noise,
        biased by station role (Main Gate gets a morning ramp-up curve).
        """
        now = datetime.now()
        n_buckets = HISTORY_WINDOW_MIN // HISTORY_BUCKET_MINUTES

        for station in self.stations.values():
            baseline = len(station.bikes)
            is_main_gate = "Main Gate" in station.name
            for i in range(n_buckets, 0, -1):
                ts = now - timedelta(minutes=i * HISTORY_BUCKET_MINUTES)
                # Smooth sine, period 6h
                wave = math.sin((i / n_buckets) * math.pi) * 4
                noise = random.uniform(-1.5, 1.5)
                if is_main_gate and self.context_tags["rush_hour"]:
                    # Inverted wave: starts lower, ramps up toward "now"
                    role_bias = -wave * 0.6
                else:
                    role_bias = wave * 0.3
                    if self.context_tags["rush_hour"] and i <= 3:
                        role_bias -= (4 - i) * 3  # Add cliff drop at the end
                count = max(0, round(baseline + role_bias + noise))
                station.history.append((ts, count))

            # Pre-seed flow events so the ETA forecast instantly shows a steep trend
            # Pre-seed a massive 75 events (-5 bikes/min) to trigger <5min ETA instantly
            if self.context_tags["rush_hour"]:
                for m in range(15, 0, -1):
                    event_time = now - timedelta(minutes=m - 0.5)
                    for _ in range(5):
                        station.flow_events.append((event_time, +1 if is_main_gate else -1))

    # ---- MQTT callbacks ----
    def on_connect(self, client, userdata, flags, reason_code, properties):
        if reason_code == 0:
            print(f"{Colors.GREEN}\u2713 Connected to MQTT Broker ({self.broker}:{self.port}){Colors.ENDC}")
            print(f"{Colors.CYAN}  Publishing to: {self.topic}{Colors.ENDC}\n")
        else:
            print(f"{Colors.FAIL}\u2717 Connection failed: {reason_code}{Colors.ENDC}")

    def on_disconnect(self, client, userdata, disconnect_flags, reason_code, properties):
        print(f"{Colors.WARNING}Disconnected (code: {reason_code}){Colors.ENDC}")

    # ---- bike movement ----
    def simulate_bikes(self):
        station_names = list(self.stations.keys())

        if self.demo_mode == "MORNING_RUSH":
            main = "Hanyang Univ. Main Gate"
            if main not in self.stations:
                sources = [s for s in station_names if len(self.stations[s].bikes) > 0]
                destinations = station_names
            else:
                # Prevent "black hole" effect
                if len(self.stations[main].bikes) >= 35:
                    sources = [main]
                    destinations = [s for s in station_names if s != main]
                else:
                    elapsed = time.time() - getattr(self, 'start_time', time.time())
                    prob = 0.95 if elapsed < 60 else 0.8
                    if random.random() < prob:
                        sources = [s for s in station_names
                                   if s != main and len(self.stations[s].bikes) > 0]
                        destinations = [main]
                    else:
                        sources = [s for s in station_names if len(self.stations[s].bikes) > 0]
                        destinations = station_names
        else:
            sources = [s for s in station_names if len(self.stations[s].bikes) > 0]
            destinations = station_names

        if not sources:
            return

        src_name = random.choice(sources)
        possible_dests = [d for d in destinations if d != src_name]
        if not possible_dests:
            possible_dests = [s for s in station_names if s != src_name]
            if not possible_dests:
                return

        dest_name = random.choice(possible_dests)
        src_station = self.stations[src_name]
        dest_station = self.stations[dest_name]

        # Move 1 to 3 bikes per tick (was 1-2; bigger fleet -> faster motion)
        num_to_move = random.randint(1, min(3, len(src_station.bikes)))
        moved = []

        for _ in range(num_to_move):
            bike = random.choice(src_station.bikes)
            src_station.remove_bike(bike)
            dest_station.add_bike(bike)
            moved.append(bike.bike_id)

        if moved:
            mode_str = "Morning Rush" if self.demo_mode == "MORNING_RUSH" else "Random Mode"
            time_str = datetime.now().strftime("%H:%M:%S")
            print(f"[{Colors.CYAN}{time_str}{Colors.ENDC}] {Colors.BOLD}{mode_str}{Colors.ENDC}: "
                  f"{Colors.WARNING}{', '.join(moved)}{Colors.ENDC} "
                  f"{Colors.BLUE}{src_name}{Colors.ENDC} \u2192 {Colors.BLUE}{dest_name}{Colors.ENDC}")

    # ---- publishing ----
    def maybe_sample_history(self, now: datetime):
        """Append a fresh history sample once per bucket interval."""
        if (now - self.last_history_sample).total_seconds() >= HISTORY_BUCKET_MINUTES * 60:
            for station in self.stations.values():
                station.record_history_sample(now)
            self.last_history_sample = now

    def publish_state(self):
        now = datetime.now()
        self.maybe_sample_history(now)

        # Delta Update Logic: Send FULL payload every 10 ticks (15s), otherwise DELTA
        if not hasattr(self, 'tick_count'):
            self.tick_count = 0
        self.tick_count += 1
        is_full = (self.tick_count % 3 == 1)

        rush = self.context_tags["rush_hour"]
        zone_data = []
        for station in self.stations.values():
            st_dict = station.to_dict(self.context_tags, now, rush)
            if is_full:
                zone_data.append(st_dict)
            else:
                # Delta payload: omit history, forecast, and static data to save bandwidth
                zone_data.append({
                    "parking_id": st_dict["parking_id"],
                    "bikes": st_dict["bikes"],
                    "status_display": st_dict["status_display"],
                    "bike_ids": st_dict["bike_ids"],
                    "net_flow_per_min": st_dict["net_flow_per_min"],
                    "depletion_eta_min": st_dict["depletion_eta_min"],
                })

        payload = {
            "type": "FULL" if is_full else "DELTA",
            "timestamp": now.strftime("%H:%M:%S"),
            "total_bikes": self.total_bikes,
            "zone_data": zone_data,
        }
        self.client.publish(self.topic, json.dumps(payload))

    # ---- main loop ----
    def run(self):
        self.start_time = time.time()
        print(f"\n{Colors.HEADER}{Colors.BOLD}=================================================={Colors.ENDC}")
        print(f"{Colors.HEADER}{Colors.BOLD} Seoul Smart City: Dockless Bike Simulator{Colors.ENDC}")
        print(f"{Colors.HEADER}{Colors.BOLD}=================================================={Colors.ENDC}\n")
        print(f"{Colors.WARNING}Mode: {self.demo_mode}{Colors.ENDC}")
        print(f"{Colors.WARNING}Fleet: {self.total_bikes} bikes across {len(self.stations)} stations{Colors.ENDC}")
        print(f"{Colors.WARNING}Context: rush_hour={self.context_tags['rush_hour']}, "
              f"holiday={self.context_tags['holiday']}, event={self.context_tags['event']}{Colors.ENDC}\n")

        if self.port == 8883:
            self.client.tls_set()

        try:
            self.client.connect(self.broker, self.port, 60)
        except Exception as e:
            print(f"{Colors.FAIL}Connection Error: {e}{Colors.ENDC}")
            return

        self.client.loop_start()

        try:
            while True:
                self.simulate_bikes()
                self.publish_state()
                time.sleep(self.update_interval)
        except KeyboardInterrupt:
            print(f"\n{Colors.WARNING}Simulator stopped.{Colors.ENDC}")
        finally:
            self.client.loop_stop()
            self.client.disconnect()


if __name__ == "__main__":
    simulator = CitySimulator("config.json")
    simulator.run()
