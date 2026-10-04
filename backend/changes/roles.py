REVIEWER_GROUP = '审核员'


def business_role(user):
    return 'reviewer' if user.groups.filter(name=REVIEWER_GROUP).exists() else 'filler'
