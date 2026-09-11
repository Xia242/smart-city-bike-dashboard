import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from City_Simulator import CitySimulator

class SimulationTests(unittest.TestCase):
    def setUp(self):
        self.sim = CitySimulator(str(Path(__file__).resolve().parents[1] / 'config.json'))
        self.source = next(iter(self.sim.stations.values()))
        self.target = list(self.sim.stations.values())[1]
        self.bike = self.source.bikes[0]
        self.sequence = 0

    def command(self, action, station=None, owner='test_client', request=None):
        self.sequence += 1
        return self.sim.process_command({'client_id':owner, 'request_id':request or f'r{self.sequence}',
                'action':action, 'station_id':(station or self.source).parking_id, 'bike_id':self.bike.bike_id})

    def test_round_trip_is_authoritative_and_idempotent(self):
        self.assertTrue(self.command('reserve')['ok'])
        self.assertFalse(self.command('reserve', owner='other')['ok'])
        self.assertTrue(self.command('unlock')['ok'])
        self.assertNotIn(self.bike, self.source.bikes)
        self.assertEqual(self.sim.snapshot(True)['total_bikes'], 74)
        self.assertTrue(self.command('return', self.target, request='return1')['ok'])
        self.assertTrue(self.command('return', self.target, request='return1')['ok'])
        self.assertEqual(self.target.bikes.count(self.bike), 1)
        self.assertEqual(self.sim.snapshot(True)['total_bikes'], 75)
        self.assertNotIn(self.bike, self.source.bikes)

    def test_reserved_bike_does_not_move_and_cancel_releases_it(self):
        self.command('reserve')
        with redirect_stdout(StringIO()):
            for _ in range(100): self.sim.simulate_bikes()
        self.assertIn(self.bike, self.source.bikes)
        self.assertTrue(self.command('cancel')['ok'])
        self.assertEqual(self.bike.status,'AVAILABLE')

    def test_closed_station_and_invalid_commands(self):
        self.source.is_open=False
        self.assertFalse(self.command('reserve')['ok'])
        self.assertIsNone(self.sim.process_command([]))
        self.assertIsNone(self.sim.process_command({'client_id':'../bad','request_id':'r'}))
        count=len(self.source.bikes)
        with redirect_stdout(StringIO()):
            for _ in range(100): self.sim.simulate_bikes()
        self.assertEqual(len(self.source.bikes),count)

    def test_sync_recovers_active_ride_and_server_restart_is_idle(self):
        self.command('reserve')
        self.command('unlock')
        result = self.command('sync')
        self.assertEqual(result['journey']['state'], 'riding')
        self.assertEqual(result['journey']['bikeId'], self.bike.bike_id)
        self.assertEqual(result['journey']['originId'], self.source.parking_id)
        self.assertIsInstance(result['journey']['rideStart'], int)
        self.command('return', self.target)
        self.assertIsNone(self.command('sync')['journey'])

    def test_unknown_or_other_owner_cannot_unlock(self):
        self.assertFalse(self.command('unlock')['ok'])
        self.command('reserve')
        self.assertFalse(self.command('unlock', owner='other')['ok'])

if __name__ == '__main__': unittest.main()
