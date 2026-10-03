import json
import re
from copy import deepcopy
from pathlib import Path

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ChangeRequest, EmcReference, EmcReferenceRow, EmcReferenceTest, EmcReferenceCell

REFERENCE = json.loads(Path(__file__).with_name("emc_reference.json").read_text(encoding="utf-8"))
METADATA = ("title", "introduction", "legend", "definitions")
KEY = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class StrictSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError({"detail": "请求内容必须是对象。"})
        forbidden = set(data) - set(self.fields)
        if forbidden:
            raise serializers.ValidationError({key: "此字段不允许修改。" for key in forbidden})
        for key, value in data.items():
            if isinstance(self.fields[key], serializers.CharField) and value is not None and not isinstance(value, str):
                raise serializers.ValidationError({key: "必须是文本。"})
        return super().to_internal_value(data)


class CellValue(StrictSerializer):
    mark = serializers.ChoiceField(choices=["", "X", "(X)"], required=False)
    remark = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False)


class EmcPatch(StrictSerializer):
    cells = serializers.DictField(child=CellValue(), required=False)

    def validate(self, attrs):
        for key in attrs.get("cells", {}):
            parts = key.split("/")
            if len(parts) != 2 or any(not KEY.fullmatch(part) for part in parts):
                raise serializers.ValidationError({"cells": {key: "交叉格标识不合法。"}})
        return attrs


def matrix_data(record):
    reference = EmcReference.objects.filter(change=record).first()
    if reference is None:
        return {**deepcopy(REFERENCE), "cells": {}, "initialized": False}
    rows = list(reference.rows.all())
    tests = list(reference.tests.all())
    row_keys = {row.pk: row.key for row in rows}
    test_keys = {test.pk: test.key for test in tests}
    return {
        **{key: getattr(reference, key) for key in METADATA},
        "rows": [{"id": row.key, "label": row.label} for row in rows],
        "tests": [{"id": test.key, "label": test.label, "group": test.group_label, "standard": test.standard_reference} for test in tests],
        "cells": {f"{row_keys[cell.row_id]}/{test_keys[cell.test_id]}": {"mark": cell.mark, "remark": cell.remark} for cell in reference.cells.all()},
        "initialized": True,
    }


def response_data(record):
    return {**matrix_data(record), "updated_at": record.updated_at.isoformat(), "can_fill": record.status == "draft"}


def apply_patch(matrix, patch):
    result = deepcopy(matrix)
    rows = {row["id"] for row in result["rows"]}
    tests = {test["id"] for test in result["tests"]}
    result["cells"] = {key: value for key, value in result["cells"].items() if key.split("/")[0] in rows and key.split("/")[1] in tests}
    for key, fields in patch.get("cells", {}).items():
        row, test = key.split("/")
        if row not in rows or test not in tests:
            raise serializers.ValidationError({"cells": {key: "典型变更或测试项目已不存在，请重读矩阵；输入仍保留。"}})
        value = {**result["cells"].get(key, {"mark": "", "remark": ""}), **fields}
        if value["mark"] or value["remark"]:
            result["cells"][key] = value
        else:
            result["cells"].pop(key, None)
    return result


def persist(record, matrix):
    reference = EmcReference.objects.filter(change=record).first()
    if reference is None:
        reference = EmcReference.objects.create(change=record, **{key: matrix[key] for key in METADATA})
        EmcReferenceRow.objects.bulk_create([EmcReferenceRow(reference=reference, key=row["id"], label=row["label"], sort_order=i) for i, row in enumerate(matrix["rows"], 1)])
        EmcReferenceTest.objects.bulk_create([EmcReferenceTest(reference=reference, key=test["id"], label=test["label"], group_label=test["group"], standard_reference=test["standard"], sort_order=i) for i, test in enumerate(matrix["tests"], 1)])
    rows = {row.key: row for row in reference.rows.all()}
    tests = {test.key: test for test in reference.tests.all()}
    existing_cells = {f"{cell.row.key}/{cell.test.key}": cell for cell in reference.cells.select_related("row", "test")}
    for key, cell in existing_cells.items():
        if key not in matrix["cells"]:
            cell.delete()
    for key, values in matrix["cells"].items():
        cell = existing_cells.get(key)
        if cell is None:
            row, test = key.split("/")
            EmcReferenceCell.objects.create(reference=reference, row=rows[row], test=tests[test], **values)
        else:
            changed = [field for field, value in values.items() if getattr(cell, field) != value]
            for field in changed:
                setattr(cell, field, values[field])
            if changed:
                cell.save(update_fields=changed)
    reference.save(update_fields=["updated_at"])
    record.updated_at = timezone.now()
    record.save(update_fields=["updated_at"])


class EmcDetail(APIView):
    http_method_names = ["get", "patch", "head", "options"]

    def record(self, request, pk):
        records = ChangeRequest.objects.select_for_update().filter(applicant=request.user)
        return get_object_or_404(records, pk=pk)

    def get(self, request, pk):
        with transaction.atomic():
            return Response(response_data(self.record(request, pk)))

    def patch(self, request, pk):
        with transaction.atomic():
            record = self.record(request, pk)
            if record.status != "draft":
                return Response({"detail": "申请已锁定，不能修改EMC。"}, status=409)
            serializer = EmcPatch(data=request.data)
            serializer.is_valid(raise_exception=True)
            patch = serializer.validated_data
            before = matrix_data(record)
            after = apply_patch(before, patch)
            if after != before:
                persist(record, after)
            return Response(response_data(record))
