from django.apps import AppConfig


class ChangesConfig(AppConfig):
    name = 'changes'

    def ready(self):
        from . import signals  # noqa: F401
