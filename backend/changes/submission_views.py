from django.contrib.auth import get_user_model
from rest_framework.response import Response
from rest_framework.views import APIView



def reviewer_data(user):
    return {'id': user.pk, 'username': user.username, 'display_name': user.get_full_name() or user.username}


def active_reviewers():
    return get_user_model().objects.filter(is_active=True).order_by('pk')


class ReviewerList(APIView):
    http_method_names = ['get', 'head', 'options']

    def get(self, request):
        return Response([reviewer_data(user) for user in active_reviewers().exclude(pk=request.user.pk)])


class ActionOwnerList(APIView):
    http_method_names = ['get', 'head', 'options']

    def get(self, request):
        return Response([reviewer_data(user) for user in active_reviewers()])
