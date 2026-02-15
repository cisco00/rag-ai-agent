
from apscheduler.schedulers.background import BackgroundScheduler
from datetime import datetime, timedelta
import time
import logging

logging.basicConfig(level=logging.INFO)

def my_job(text):
    print(f"Job executed: {text}")

scheduler = BackgroundScheduler()
scheduler.start()

print("Scheduler started")

# Schedule a job in the past
past_time = datetime.now() - timedelta(hours=24)
print(f"Scheduling job for {past_time}")

try:
    scheduler.add_job(my_job, 'date', run_date=past_time, args=['past job'], misfire_grace_time=None)
    print("Job scheduled (misfire_grace_time=None)")
except Exception as e:
    print(f"Error scheduling: {e}")

time.sleep(2)
scheduler.shutdown()
