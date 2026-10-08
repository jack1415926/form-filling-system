from datetime import date

from django.test import SimpleTestCase
from rest_framework import serializers

from .dates import BusinessDateField
from .execution_plan_views import PlanValueSerializer
from .models import ExecutionPlanResponse
from .serializers import ChangeRequestSerializer, EcrActionSerializer, EcoActionSerializer


class BusinessDateTests(SimpleTestCase):
    def test_range_calendar_and_clearing_on_every_date_write_serializer(self):
        for serializer_class, fields in [
            (ChangeRequestSerializer, ["planned_eco_date"]),
            (EcrActionSerializer, ["date"]),
            (EcoActionSerializer, ["date"]),
            (PlanValueSerializer, ["start_date", "end_date"]),
        ]:
            for field in fields:
                for value in [None, "2000-01-01", "2100-12-31", "2000-02-29", "2026-09-30"]:
                    with self.subTest(serializer=serializer_class.__name__, field=field, value=value):
                        kwargs = {"instance": ExecutionPlanResponse()} if serializer_class is PlanValueSerializer else {}
                        serializer = serializer_class(data={field: value}, partial=True, **kwargs)
                        self.assertTrue(serializer.is_valid(), serializer.errors)
                        self.assertEqual(serializer.validated_data[field], None if value is None else date.fromisoformat(value))
                for value in ["1999-12-31", "2101-01-01", "9999-12-31", "2026-09-31", "2100-02-29", "2026-09-"]:
                    with self.subTest(serializer=serializer_class.__name__, field=field, value=value):
                        serializer = serializer_class(data={field: value}, partial=True)
                        self.assertFalse(serializer.is_valid())
                        self.assertIn(field, serializer.errors)

    def test_range_rejection_identifies_the_business_rule(self):
        with self.assertRaisesMessage(serializers.ValidationError, "2000～2100"):
            BusinessDateField().run_validation("9999-12-31")
